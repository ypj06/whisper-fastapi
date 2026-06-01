"""
Unit tests for the audio preprocessing pipeline.

Tests cover:
- Noise reduction algorithms
- Voice activity detection
- Signal enhancement
- Pipeline integration
- Evaluation metrics
- Utility functions
"""

import unittest

import numpy as np

# Add parent directory to path for imports
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.utils.audio_utils import (
    normalize_audio,
    compute_snr,
    compute_rms,
    mix_audio_with_noise,
    trim_silence,
)
from src.preprocessing.noise_reduction import (
    spectral_subtraction,
    wiener_filter,
    kalman_denoise,
)
from src.preprocessing.voice_activity_detection import energy_based_vad
from src.preprocessing.signal_enhancement import (
    dynamic_range_compression,
    automatic_gain_control,
)
from src.preprocessing.pipeline import (
    AudioPreprocessingPipeline,
    PreprocessingConfig,
)
from src.evaluation.metrics import (
    compute_wer,
    compute_cer,
    compute_all_metrics,
    compute_relative_improvement,
)


class TestAudioUtils(unittest.TestCase):
    """Test audio utility functions."""

    def setUp(self):
        self.sr = 16000
        self.duration = 2.0
        self.t = np.linspace(0, self.duration, int(self.sr * self.duration), endpoint=False)

    def test_normalize_audio(self):
        """Test audio normalization."""
        audio = np.sin(2 * np.pi * 440 * self.t) * 0.5
        normalized = normalize_audio(audio, target_db=-20)
        rms = compute_rms(normalized)
        rms_db = 20 * np.log10(rms + 1e-10)
        self.assertAlmostEqual(rms_db, -20.0, delta=0.5)

    def test_normalize_silence(self):
        """Test normalizing silent audio doesn't crash."""
        audio = np.zeros(1000)
        normalized = normalize_audio(audio)
        self.assertEqual(len(normalized), 1000)
        self.assertTrue(np.all(normalized == 0))

    def test_compute_snr(self):
        """Test SNR computation."""
        signal = np.ones(1000) * 0.1
        noise = np.ones(1000) * 0.01
        snr = compute_snr(signal, noise)
        self.assertAlmostEqual(snr, 20.0, delta=0.1)

    def test_compute_snr_zero_noise(self):
        """Test SNR with zero noise."""
        signal = np.ones(1000)
        noise = np.zeros(1000)
        snr = compute_snr(signal, noise)
        self.assertEqual(snr, float("inf"))

    def test_mix_audio_with_noise(self):
        """Test mixing audio with noise at specified SNR."""
        clean = np.sin(2 * np.pi * 440 * self.t)
        noise = np.random.randn(len(clean))
        mixed = mix_audio_with_noise(clean, noise, 20)
        self.assertEqual(len(mixed), len(clean))
        # Output should be different from clean
        self.assertFalse(np.allclose(mixed, clean))

    def test_trim_silence(self):
        """Test silence trimming."""
        sr = 16000
        # Create audio with silence padding
        silence = np.zeros(int(0.5 * sr))
        tone = np.sin(2 * np.pi * 440 * np.linspace(0, 1, sr, endpoint=False)) * 0.5
        audio = np.concatenate([silence, tone, silence])

        trimmed = trim_silence(audio, sr, top_db=20)
        # Trimmed should be shorter
        self.assertLess(len(trimmed), len(audio))
        # Should not be empty
        self.assertGreater(len(trimmed), 0)


class TestNoiseReduction(unittest.TestCase):
    """Test noise reduction algorithms."""

    def setUp(self):
        self.sr = 16000
        self.duration = 2.0
        self.t = np.linspace(0, self.duration, int(self.sr * self.duration), endpoint=False)
        self.clean = normalize_audio(np.sin(2 * np.pi * 440 * self.t))
        self.noise = np.random.randn(len(self.clean)) * 0.05
        self.noisy = mix_audio_with_noise(self.clean, self.noise, 10)

    def test_spectral_subtraction(self):
        """Test spectral subtraction reduces noise."""
        result = spectral_subtraction(self.noisy, self.sr)
        self.assertEqual(len(result), len(self.noisy))
        # Correlation with clean should improve
        orig_corr = np.corrcoef(self.clean, self.noisy)[0, 1]
        result_corr = np.corrcoef(
            self.clean[:len(result)], result[:len(self.clean)]
        )[0, 1]
        self.assertGreaterEqual(result_corr, orig_corr * 0.9)  # Close to or better

    def test_wiener_filter(self):
        """Test Wiener filter produces valid output."""
        result = wiener_filter(self.noisy, self.sr)
        self.assertEqual(len(result), len(self.noisy))
        self.assertFalse(np.any(np.isnan(result)))
        self.assertFalse(np.any(np.isinf(result)))

    def test_kalman_denoise(self):
        """Test Kalman denoiser output."""
        result = kalman_denoise(self.noisy, self.sr)
        self.assertEqual(len(result), len(self.noisy))
        self.assertFalse(np.any(np.isnan(result)))

    def test_spectral_subtraction_with_silence(self):
        """Test spectral subtraction handles near-silence gracefully."""
        silent = np.zeros(int(self.sr * 0.5))
        result = spectral_subtraction(silent, self.sr)
        self.assertEqual(len(result), len(silent))


class TestVoiceActivityDetection(unittest.TestCase):
    """Test VAD algorithms."""

    def setUp(self):
        self.sr = 16000

    def test_energy_vad_with_speech(self):
        """Test energy-based VAD detects speech."""
        duration = 3.0
        t = np.linspace(0, duration, int(self.sr * duration), endpoint=False)
        audio = np.sin(2 * np.pi * 440 * t) * 0.5
        segments = energy_based_vad(audio, self.sr)
        self.assertGreater(len(segments), 0)

    def test_energy_vad_with_silence(self):
        """Test energy-based VAD with silence returns no segments."""
        audio = np.zeros(int(self.sr * 2))
        segments = energy_based_vad(audio, self.sr, energy_threshold=0.01)
        self.assertEqual(len(segments), 0)


class TestSignalEnhancement(unittest.TestCase):
    """Test signal enhancement functions."""

    def setUp(self):
        self.sr = 16000
        self.duration = 1.0
        self.t = np.linspace(0, self.duration, int(self.sr * self.duration), endpoint=False)

    def test_dynamic_range_compression(self):
        """Test DRC produces valid output."""
        audio = normalize_audio(np.sin(2 * np.pi * 440 * self.t) * 0.5)
        result = dynamic_range_compression(audio, self.sr)
        self.assertEqual(len(result), len(audio))
        self.assertFalse(np.any(np.isnan(result)))
        # Output should be at or below 1.0
        self.assertLessEqual(np.max(np.abs(result)), 1.0)

    def test_agc(self):
        """Test AGC normalizes levels."""
        quiet = normalize_audio(np.sin(2 * np.pi * 440 * self.t)) * 0.1
        loud = normalize_audio(np.sin(2 * np.pi * 440 * self.t)) * 0.8

        quiet_agc = automatic_gain_control(quiet, self.sr)
        loud_agc = automatic_gain_control(loud, self.sr)

        quiet_rms = compute_rms(quiet_agc)
        loud_rms = compute_rms(loud_agc)

        # Both should be close to target level
        self.assertAlmostEqual(quiet_rms, loud_rms, delta=0.1)


class TestPipeline(unittest.TestCase):
    """Test the full preprocessing pipeline."""

    def setUp(self):
        self.sr = 16000
        self.duration = 2.0
        self.t = np.linspace(0, self.duration, int(self.sr * self.duration), endpoint=False)
        self.audio = normalize_audio(np.sin(2 * np.pi * 440 * self.t) * 0.3)

    def test_pipeline_creation(self):
        """Test pipeline can be created."""
        pipeline = AudioPreprocessingPipeline()
        self.assertIsNotNone(pipeline.config)

    def test_pipeline_from_preset(self):
        """Test pipeline creation from presets."""
        for preset in ["mobile", "desktop_high_quality", "lightweight"]:
            pipeline = AudioPreprocessingPipeline.from_preset(preset)
            self.assertIsNotNone(pipeline.config)

    def test_pipeline_invalid_preset(self):
        """Test invalid preset raises error."""
        with self.assertRaises(ValueError):
            AudioPreprocessingPipeline.from_preset("nonexistent")

    def test_pipeline_process(self):
        """Test pipeline processes audio end-to-end."""
        pipeline = AudioPreprocessingPipeline.from_preset("mobile")
        result, stats = pipeline.process(self.audio, self.sr)
        self.assertIsInstance(result, np.ndarray)
        self.assertIsNotNone(stats)
        self.assertGreater(stats.input_duration, 0)

    def test_pipeline_process_no_return_stats(self):
        """Test pipeline without stats return."""
        pipeline = AudioPreprocessingPipeline.from_preset("lightweight")
        result = pipeline.process(self.audio, self.sr, return_stats=False)
        self.assertIsInstance(result, np.ndarray)

    def test_pipeline_with_disabled_stages(self):
        """Test pipeline with all stages disabled."""
        config = PreprocessingConfig(
            enable_vad=False,
            enable_noise_reduction=False,
            enable_signal_enhancement=False,
        )
        pipeline = AudioPreprocessingPipeline(config)
        result, stats = pipeline.process(self.audio, self.sr)
        self.assertEqual(len(result), len(self.audio))  # No VAD = same length

    def test_pipeline_preset_config(self):
        """Test all presets produce valid configs."""
        for preset_name, config in [
            ("mobile", None),
            ("desktop_high_quality", None),
            ("noisy_environment", None),
            ("meeting_room", None),
            ("lightweight", None),
        ]:
            pipeline = AudioPreprocessingPipeline.from_preset(preset_name)
            config_dict = pipeline.config.to_dict()
            self.assertIn("enable_vad", config_dict)
            self.assertIn("enable_noise_reduction", config_dict)


class TestMetrics(unittest.TestCase):
    """Test evaluation metrics."""

    def test_wer_perfect(self):
        """Test WER with identical strings."""
        self.assertEqual(compute_wer("hello world", "hello world"), 0.0)

    def test_wer_one_error(self):
        """Test WER with one substitution."""
        ref = "hello world"
        hyp = "hello word"
        wer = compute_wer(ref, hyp)
        self.assertAlmostEqual(wer, 0.5, delta=0.01)

    def test_wer_completely_different(self):
        """Test WER with completely different strings."""
        ref = "the quick brown fox"
        hyp = "a completely different sentence"
        wer = compute_wer(ref, hyp)
        self.assertGreater(wer, 0.5)

    def test_wer_empty_reference(self):
        """Test WER with empty reference."""
        self.assertEqual(compute_wer("", "hello"), 1.0)
        self.assertEqual(compute_wer("", ""), 0.0)

    def test_cer_perfect(self):
        """Test CER with identical strings."""
        self.assertEqual(compute_cer("hello", "hello"), 0.0)

    def test_all_metrics(self):
        """Test all metrics are computed."""
        metrics = compute_all_metrics("hello world", "hello word")
        self.assertIn("wer", metrics)
        self.assertIn("cer", metrics)
        self.assertIn("mer", metrics)
        self.assertIn("wil", metrics)

    def test_relative_improvement(self):
        """Test relative improvement calculation."""
        improvement = compute_relative_improvement(0.30, 0.15)
        self.assertAlmostEqual(improvement, 50.0, delta=0.1)

        # Negative improvement (degradation)
        degradation = compute_relative_improvement(0.15, 0.30)
        self.assertAlmostEqual(degradation, -100.0, delta=1.0)

        # Zero baseline
        self.assertEqual(compute_relative_improvement(0.0, 0.05), 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
