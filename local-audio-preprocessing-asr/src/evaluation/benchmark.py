"""
Benchmarking framework for evaluating preprocessing impact on ASR.

Compares ASR performance with and without preprocessing across:
- Different preprocessing configurations
- Various noise conditions and SNR levels
- Multiple ASR models (Whisper sizes)
- Different audio types (clean, noisy, reverberant)

Generates comprehensive reports with statistical analysis.
"""

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import numpy as np

from .metrics import compute_all_metrics, compute_relative_improvement


@dataclass
class BenchmarkResult:
    """Result of a single benchmark run."""

    audio_id: str
    condition: str  # e.g., "clean", "noisy_5db", "noisy_10db"
    preprocessing: str  # e.g., "none", "spectral_gating", "full_pipeline"
    reference: str
    hypothesis: str
    metrics: Dict[str, float] = field(default_factory=dict)
    audio_duration_s: float = 0.0
    processing_time_s: float = 0.0
    asr_time_s: float = 0.0

    def __post_init__(self):
        if not self.metrics:
            self.metrics = compute_all_metrics(self.reference, self.hypothesis)


@dataclass
class BenchmarkReport:
    """Aggregated benchmark report."""

    results: List[BenchmarkResult] = field(default_factory=list)
    summary: Dict[str, Any] = field(default_factory=dict)

    def compute_summary(self) -> Dict[str, Any]:
        """Compute summary statistics across all results."""
        if not self.results:
            return {}

        summary = {
            "total_samples": len(self.results),
            "conditions": {},
            "preprocessing_methods": {},
            "overall": {},
        }

        # Group by condition + preprocessing
        for result in self.results:
            key = f"{result.condition}_{result.preprocessing}"
            if key not in summary["conditions"]:
                summary["conditions"][key] = {
                    "condition": result.condition,
                    "preprocessing": result.preprocessing,
                    "wer_values": [],
                    "cer_values": [],
                    "count": 0,
                }

            entry = summary["conditions"][key]
            entry["wer_values"].append(result.metrics["wer"])
            entry["cer_values"].append(result.metrics["cer"])
            entry["count"] += 1

        # Compute averages
        for key, entry in summary["conditions"].items():
            entry["avg_wer"] = float(np.mean(entry["wer_values"]))
            entry["std_wer"] = float(np.std(entry["wer_values"]))
            entry["avg_cer"] = float(np.mean(entry["cer_values"]))
            entry["std_cer"] = float(np.std(entry["cer_values"]))
            del entry["wer_values"]
            del entry["cer_values"]

        # Compare preprocessing vs no-preprocessing within each condition
        comparisons = []
        conditions_set = set(r.condition for r in self.results)

        for condition in conditions_set:
            baseline = [
                r for r in self.results
                if r.condition == condition and r.preprocessing == "none"
            ]
            preprocessed = [
                r for r in self.results
                if r.condition == condition and r.preprocessing != "none"
            ]

            if baseline and preprocessed:
                baseline_wer = np.mean([r.metrics["wer"] for r in baseline])
                for pp in set(r.preprocessing for r in preprocessed):
                    pp_results = [r for r in preprocessed if r.preprocessing == pp]
                    pp_wer = np.mean([r.metrics["wer"] for r in pp_results])
                    improvement = compute_relative_improvement(baseline_wer, pp_wer)
                    comparisons.append({
                        "condition": condition,
                        "preprocessing": pp,
                        "baseline_wer": round(baseline_wer, 4),
                        "preprocessed_wer": round(pp_wer, 4),
                        "relative_improvement_pct": round(improvement, 2),
                    })

        summary["comparisons"] = comparisons

        # Overall averages
        all_baseline = [r for r in self.results if r.preprocessing == "none"]
        all_preprocessed = [r for r in self.results if r.preprocessing != "none"]

        summary["overall"] = {
            "baseline_avg_wer": round(
                float(np.mean([r.metrics["wer"] for r in all_baseline])), 4
            ) if all_baseline else None,
            "preprocessed_avg_wer": round(
                float(np.mean([r.metrics["wer"] for r in all_preprocessed])), 4
            ) if all_preprocessed else None,
        }

        if all_baseline and all_preprocessed:
            summary["overall"]["relative_improvement_pct"] = round(
                compute_relative_improvement(
                    summary["overall"]["baseline_avg_wer"],
                    summary["overall"]["preprocessed_avg_wer"],
                ), 2
            )

        self.summary = summary
        return summary

    def to_json(self, file_path: Union[str, Path]) -> None:
        """Save report to JSON file."""
        output = {
            "summary": self.summary,
            "results": [
                {
                    "audio_id": r.audio_id,
                    "condition": r.condition,
                    "preprocessing": r.preprocessing,
                    "metrics": r.metrics,
                    "audio_duration_s": r.audio_duration_s,
                    "processing_time_s": r.processing_time_s,
                    "asr_time_s": r.asr_time_s,
                }
                for r in self.results
            ],
        }
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2, ensure_ascii=False)

    def print_summary(self) -> None:
        """Pretty-print the benchmark summary."""
        if not self.summary:
            self.compute_summary()

        print("\n" + "=" * 70)
        print("  AUDIO PREPROCESSING BENCHMARK REPORT")
        print("=" * 70)

        # Overall results
        overall = self.summary.get("overall", {})
        if overall:
            print(f"\n  Overall Results:")
            print(f"    Baseline WER (no preprocessing):  {overall.get('baseline_avg_wer', 'N/A'):.4f}")
            print(f"    Preprocessed WER:                 {overall.get('preprocessed_avg_wer', 'N/A'):.4f}")
            if "relative_improvement_pct" in overall:
                imp = overall["relative_improvement_pct"]
                direction = "improvement" if imp > 0 else "degradation"
                print(f"    Relative {direction}:              {abs(imp):.1f}%")

        # Per-condition comparisons
        comparisons = self.summary.get("comparisons", [])
        if comparisons:
            print(f"\n  Per-Condition Comparison:")
            print(f"    {'Condition':<20} {'Preprocessing':<20} {'Baseline WER':>12} {'Processed WER':>13} {'Improvement':>12}")
            print(f"    {'-'*19} {'-'*19} {'-'*12} {'-'*13} {'-'*12}")
            for c in comparisons:
                imp_str = f"{c['relative_improvement_pct']:+.1f}%"
                print(
                    f"    {c['condition']:<20} {c['preprocessing']:<20} "
                    f"{c['baseline_wer']:>12.4f} {c['preprocessed_wer']:>13.4f} "
                    f"{imp_str:>12}"
                )

        print("\n" + "=" * 70)


class ASRBenchmark:
    """Benchmark runner for evaluating preprocessing impact on ASR.

    Usage:
        benchmark = ASRBenchmark(asr_fn=my_transcribe_function)
        benchmark.add_test_case(audio, sr, "clean audio", reference_text)
        benchmark.add_preprocessing_config("spectral_gating", pipeline_config)
        report = benchmark.run()
        report.print_summary()
    """

    def __init__(
        self,
        asr_fn: Callable[[np.ndarray, int], str],
        asr_name: str = "whisper",
    ):
        """Initialize benchmark.

        Args:
            asr_fn: Function that takes (audio, sr) and returns transcript.
            asr_name: Name of the ASR model for reporting.
        """
        self.asr_fn = asr_fn
        self.asr_name = asr_name
        self.test_cases: List[Dict[str, Any]] = []
        self.preprocessing_configs: Dict[str, Any] = {"none": None}

    def add_test_case(
        self,
        audio: np.ndarray,
        sr: int,
        condition: str,
        reference: str,
        audio_id: Optional[str] = None,
    ) -> None:
        """Add a test case for benchmarking.

        Args:
            audio: Audio samples.
            sr: Sample rate.
            condition: Description of audio condition (e.g., "noisy_10db").
            reference: Ground truth transcript.
            audio_id: Optional identifier for this audio.
        """
        if audio_id is None:
            audio_id = f"sample_{len(self.test_cases):04d}"

        self.test_cases.append({
            "audio": audio,
            "sr": sr,
            "condition": condition,
            "reference": reference,
            "audio_id": audio_id,
        })

    def add_preprocessing_config(
        self,
        name: str,
        pipeline_or_config,
    ) -> None:
        """Add a preprocessing configuration to benchmark.

        Args:
            name: Name for this preprocessing method.
            pipeline_or_config: AudioPreprocessingPipeline or PreprocessingConfig.
        """
        self.preprocessing_configs[name] = pipeline_or_config

    def run(
        self,
        verbose: bool = True,
    ) -> BenchmarkReport:
        """Run the full benchmark.

        For each test case, runs ASR with and without each preprocessing
        configuration, collecting all metrics.

        Args:
            verbose: Print progress during benchmark.

        Returns:
            BenchmarkReport with all results.
        """
        from tqdm import tqdm

        from ..preprocessing.pipeline import AudioPreprocessingPipeline

        report = BenchmarkReport()
        total_runs = len(self.test_cases) * len(self.preprocessing_configs)

        iterator = tqdm(
            total=total_runs,
            desc="Benchmarking",
            disable=not verbose,
        )

        for tc in self.test_cases:
            for pp_name, pp_config in self.preprocessing_configs.items():
                audio = tc["audio"].copy()
                sr = tc["sr"]
                processing_time = 0.0

                # Apply preprocessing
                if pp_name != "none" and pp_config is not None:
                    t_start = time.time()
                    if isinstance(pp_config, AudioPreprocessingPipeline):
                        pipeline = pp_config
                    else:
                        pipeline = AudioPreprocessingPipeline(pp_config)
                    audio, stats = pipeline.process(audio, sr)
                    processing_time = time.time() - t_start

                # Run ASR
                t_asr = time.time()
                try:
                    hypothesis = self.asr_fn(audio, sr)
                except Exception as e:
                    if verbose:
                        tqdm.write(f"ASR error for {tc['audio_id']}/{pp_name}: {e}")
                    hypothesis = ""
                asr_time = time.time() - t_asr

                # Compute metrics
                metrics = compute_all_metrics(tc["reference"], hypothesis)

                # Record result
                result = BenchmarkResult(
                    audio_id=tc["audio_id"],
                    condition=tc["condition"],
                    preprocessing=pp_name,
                    reference=tc["reference"],
                    hypothesis=hypothesis,
                    metrics=metrics,
                    audio_duration_s=len(audio) / sr,
                    processing_time_s=processing_time,
                    asr_time_s=asr_time,
                )
                report.results.append(result)

                iterator.update(1)
                if verbose:
                    iterator.set_postfix(
                        sample=tc["audio_id"][:12],
                        pp=pp_name,
                        wer=f"{metrics['wer']:.3f}",
                    )

        iterator.close()
        report.compute_summary()
        return report

    def run_quick(
        self,
        audio: np.ndarray,
        sr: int,
        reference: str,
        condition: str = "test",
        audio_id: str = "quick_test",
        verbose: bool = True,
    ) -> BenchmarkReport:
        """Quick benchmark with a single audio sample.

        Convenience method for rapid testing.

        Args:
            audio: Audio samples.
            sr: Sample rate.
            reference: Ground truth transcript.
            condition: Audio condition label.
            audio_id: Audio identifier.
            verbose: Print results.

        Returns:
            BenchmarkReport.
        """
        self.add_test_case(audio, sr, condition, reference, audio_id)
        return self.run(verbose=verbose)
