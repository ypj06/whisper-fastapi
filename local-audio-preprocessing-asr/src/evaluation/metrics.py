"""
ASR Evaluation Metrics.

Computes standard ASR performance metrics:
- Word Error Rate (WER)
- Character Error Rate (CER)
- Match Error Rate (MER)
- Word Information Lost (WIL)
- Word Information Preserved (WIP)

Used to compare ASR performance with and without preprocessing.
"""

from typing import Dict, List, Optional, Tuple

import numpy as np


def compute_wer(reference: str, hypothesis: str) -> float:
    """Compute Word Error Rate between reference and hypothesis.

    WER = (Substitutions + Deletions + Insertions) / Reference_Words

    Uses Levenshtein distance at the word level.

    Args:
        reference: Ground truth transcript.
        hypothesis: ASR output transcript.

    Returns:
        WER as a float (0.0 = perfect match).
    """
    ref_words = reference.strip().split()
    hyp_words = hypothesis.strip().split()

    if len(ref_words) == 0:
        return float(len(hyp_words) > 0)  # 0 if both empty, 1 if hyp has words

    d = np.zeros((len(ref_words) + 1, len(hyp_words) + 1), dtype=int)

    for i in range(len(ref_words) + 1):
        d[i, 0] = i
    for j in range(len(hyp_words) + 1):
        d[0, j] = j

    for i in range(1, len(ref_words) + 1):
        for j in range(1, len(hyp_words) + 1):
            if ref_words[i - 1].lower() == hyp_words[j - 1].lower():
                d[i, j] = d[i - 1, j - 1]
            else:
                d[i, j] = min(
                    d[i - 1, j] + 1,     # Deletion
                    d[i, j - 1] + 1,     # Insertion
                    d[i - 1, j - 1] + 1, # Substitution
                )

    return float(d[len(ref_words), len(hyp_words)] / len(ref_words))


def compute_cer(reference: str, hypothesis: str) -> float:
    """Compute Character Error Rate.

    Like WER but at the character level. More useful for languages
    like Chinese where word boundaries are ambiguous.

    Args:
        reference: Ground truth transcript.
        hypothesis: ASR output transcript.

    Returns:
        CER as a float (0.0 = perfect match).
    """
    # Normalize: remove extra whitespace
    ref_chars = list(" ".join(reference.strip().split()))
    hyp_chars = list(" ".join(hypothesis.strip().split()))

    if len(ref_chars) == 0:
        return float(len(hyp_chars) > 0)

    d = np.zeros((len(ref_chars) + 1, len(hyp_chars) + 1), dtype=int)

    for i in range(len(ref_chars) + 1):
        d[i, 0] = i
    for j in range(len(hyp_chars) + 1):
        d[0, j] = j

    for i in range(1, len(ref_chars) + 1):
        for j in range(1, len(hyp_chars) + 1):
            if ref_chars[i - 1] == hyp_chars[j - 1]:
                d[i, j] = d[i - 1, j - 1]
            else:
                d[i, j] = min(
                    d[i - 1, j] + 1,
                    d[i, j - 1] + 1,
                    d[i - 1, j - 1] + 1,
                )

    return float(d[len(ref_chars), len(hyp_chars)] / len(ref_chars))


def compute_mer(reference: str, hypothesis: str) -> float:
    """Compute Match Error Rate.

    MER = (S + D + I) / (S + D + C)

    Where S=substitutions, D=deletions, I=insertions, C=correct words.

    Args:
        reference: Ground truth transcript.
        hypothesis: ASR output transcript.

    Returns:
        MER as a float.
    """
    ref_words = reference.strip().split()
    hyp_words = hypothesis.strip().split()

    # Compute alignments via Levenshtein
    d = np.zeros((len(ref_words) + 1, len(hyp_words) + 1), dtype=int)
    for i in range(len(ref_words) + 1):
        d[i, 0] = i
    for j in range(len(hyp_words) + 1):
        d[0, j] = j

    for i in range(1, len(ref_words) + 1):
        for j in range(1, len(hyp_words) + 1):
            cost = 0 if ref_words[i - 1].lower() == hyp_words[j - 1].lower() else 1
            d[i, j] = min(
                d[i - 1, j] + 1,
                d[i, j - 1] + 1,
                d[i - 1, j - 1] + cost,
            )

    # Backtrace to count errors
    i, j = len(ref_words), len(hyp_words)
    substitutions = 0
    deletions = 0
    insertions = 0
    correct = 0

    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i, j] == d[i - 1, j - 1] + (
            0 if ref_words[i - 1].lower() == hyp_words[j - 1].lower() else 1
        ):
            if ref_words[i - 1].lower() == hyp_words[j - 1].lower():
                correct += 1
            else:
                substitutions += 1
            i -= 1
            j -= 1
        elif i > 0 and d[i, j] == d[i - 1, j] + 1:
            deletions += 1
            i -= 1
        else:
            insertions += 1
            j -= 1

    errors = substitutions + deletions + insertions
    total = substitutions + deletions + correct

    return float(errors / total) if total > 0 else 0.0


def compute_wil(reference: str, hypothesis: str) -> float:
    """Compute Word Information Lost.

    WIL = 1 - WIP (Word Information Preserved)
    Balances precision and recall of word recognition.

    WIP is like F1 but for ASR: harmonic mean of
    (correct / reference_length) and (correct / hypothesis_length).

    Args:
        reference: Ground truth transcript.
        hypothesis: ASR output transcript.

    Returns:
        WIL as a float (0.0 = no information lost).
    """
    ref_words = reference.strip().split()
    hyp_words = hypothesis.strip().split()

    # Count correct words via alignment
    d = np.zeros((len(ref_words) + 1, len(hyp_words) + 1), dtype=int)
    for i in range(len(ref_words) + 1):
        d[i, 0] = i
    for j in range(len(hyp_words) + 1):
        d[0, j] = j

    for i in range(1, len(ref_words) + 1):
        for j in range(1, len(hyp_words) + 1):
            cost = 0 if ref_words[i - 1].lower() == hyp_words[j - 1].lower() else 1
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + cost)

    # Backtrace
    i, j = len(ref_words), len(hyp_words)
    correct = 0
    while i > 0 and j > 0:
        if ref_words[i - 1].lower() == hyp_words[j - 1].lower():
            correct += 1
            i -= 1
            j -= 1
        elif d[i - 1, j] <= d[i, j - 1] and d[i - 1, j] < d[i - 1, j - 1]:
            i -= 1
        elif d[i, j - 1] < d[i - 1, j] and d[i, j - 1] < d[i - 1, j - 1]:
            j -= 1
        else:
            i -= 1
            j -= 1

    if len(ref_words) == 0 and len(hyp_words) == 0:
        return 0.0
    if len(ref_words) == 0:
        return 1.0
    if len(hyp_words) == 0:
        return 1.0

    precision = correct / max(len(hyp_words), 1)
    recall = correct / max(len(ref_words), 1)

    if precision + recall == 0:
        return 1.0

    wip = 2 * precision * recall / (precision + recall)
    return 1.0 - wip


def compute_all_metrics(
    reference: str,
    hypothesis: str,
) -> Dict[str, float]:
    """Compute all ASR evaluation metrics.

    Args:
        reference: Ground truth transcript.
        hypothesis: ASR output transcript.

    Returns:
        Dictionary with all metrics.
    """
    return {
        "wer": compute_wer(reference, hypothesis),
        "cer": compute_cer(reference, hypothesis),
        "mer": compute_mer(reference, hypothesis),
        "wil": compute_wil(reference, hypothesis),
    }


def compute_relative_improvement(
    baseline_wer: float,
    preprocessed_wer: float,
) -> float:
    """Compute relative WER improvement from preprocessing.

    Args:
        baseline_wer: WER without preprocessing.
        preprocessed_wer: WER with preprocessing.

    Returns:
        Relative improvement as percentage (positive = better).
    """
    if baseline_wer == 0:
        return 0.0
    return ((baseline_wer - preprocessed_wer) / baseline_wer) * 100


def format_metrics_table(
    metrics_dict: Dict[str, Dict[str, float]],
) -> str:
    """Format metrics as a comparison table string.

    Args:
        metrics_dict: {condition_name: {metric_name: value}}

    Returns:
        Formatted table string.
    """
    if not metrics_dict:
        return "No metrics to display."

    conditions = list(metrics_dict.keys())
    metric_names = list(metrics_dict[conditions[0]].keys())

    # Header
    header = f"{'Metric':<12}" + "".join(f"{c:>15}" for c in conditions)
    separator = "-" * len(header)

    rows = [header, separator]

    for metric in metric_names:
        row = f"{metric:<12}"
        for cond in conditions:
            value = metrics_dict[cond].get(metric, float("nan"))
            if metric in ("wer", "cer", "mer", "wil"):
                row += f"{value:>14.4f}"
            else:
                row += f"{value:>14.2f}"
        rows.append(row)

    return "\n".join(rows)
