"""
Audio utility functions for loading, saving, and visualizing audio files.

Provides a consistent interface for audio I/O across different formats
(including video files that contain audio tracks) and sample rates,
plus visualization helpers for analysis.

Supported input: WAV, MP3, M4A, FLAC, OGG, MP4, MKV, WEBM, FLV, and more.
"""

from pathlib import Path
from typing import Optional, Tuple, Union
import io

import numpy as np
import soundfile as sf
import librosa
import matplotlib.pyplot as plt

# Video file extensions that contain audio tracks
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".flv", ".avi", ".mov", ".wmv", ".m4v"}


def load_audio(
    file_path: Union[str, Path],
    target_sr: int = 16000,
    mono: bool = True,
    duration: Optional[float] = None,
    offset: float = 0.0,
) -> Tuple[np.ndarray, int]:
    """Load an audio or video file and resample to target sample rate.

    For video files (MP4, MKV, etc.), the audio track is automatically
    extracted using ffmpeg (via pydub). For audio files, uses librosa
    directly. You must have ffmpeg installed on your system for video
    file support.

    Args:
        file_path: Path to the audio or video file.
        target_sr: Target sample rate in Hz (default 16000 for ASR).
        mono: Convert to mono if True.
        duration: Only load up to this many seconds.
        offset: Start reading after this many seconds.

    Returns:
        Tuple of (audio_samples, sample_rate).
    """
    file_path = Path(file_path)
    suffix = file_path.suffix.lower()

    # ── Video files: extract audio track via ffmpeg/pydub ──
    if suffix in VIDEO_EXTENSIONS:
        return _load_audio_from_video(
            file_path, target_sr, mono, duration, offset
        )

    # ── Audio files: use librosa directly ──
    audio, sr = librosa.load(
        str(file_path),
        sr=target_sr,
        mono=mono,
        duration=duration,
        offset=offset,
    )
    return audio, sr


def _load_audio_from_video(
    file_path: Path,
    target_sr: int,
    mono: bool,
    duration: Optional[float],
    offset: float,
) -> Tuple[np.ndarray, int]:
    """Extract audio track from a video file using ffmpeg/pydub.

    Falls back to librosa if pydub or ffmpeg is not available.
    """
    try:
        from pydub import AudioSegment

        audio_segment = AudioSegment.from_file(str(file_path))

        # Apply offset/duration trimming
        if offset > 0 or duration is not None:
            start_ms = int(offset * 1000)
            end_ms = int((offset + duration) * 1000) if duration else len(audio_segment)
            audio_segment = audio_segment[start_ms:end_ms]

        # Convert to mono
        if mono and audio_segment.channels > 1:
            audio_segment = audio_segment.set_channels(1)

        # Resample if needed
        if audio_segment.frame_rate != target_sr:
            audio_segment = audio_segment.set_frame_rate(target_sr)

        # Convert to numpy array
        samples = np.array(audio_segment.get_array_of_samples(), dtype=np.float32)
        # pydub returns 16-bit integers; normalize to [-1, 1]
        max_val = float(2 ** (8 * audio_segment.sample_width - 1))
        samples = samples / max_val

        return samples, target_sr

    except (ImportError, FileNotFoundError):
        # pydub not installed OR ffmpeg not found — try librosa as fallback
        import warnings
        warnings.warn(
            f"pydub/ffmpeg not available for '{file_path.name}'. "
            f"Falling back to librosa."
        )
        try:
            audio, sr = librosa.load(
                str(file_path),
                sr=target_sr,
                mono=mono,
                duration=duration,
                offset=offset,
            )
            return audio, sr
        except Exception:
            raise RuntimeError(
                f"Cannot read '{file_path.name}'. "
                f"Video files require ffmpeg. Install it:\n"
                f"  Windows: download from https://ffmpeg.org/download.html\n"
                f"           and add the bin/ folder to your system PATH.\n"
                f"  Or use an audio-only format (.wav, .mp3, .m4a) instead."
            )


# Alias for clarity when the caller explicitly expects video files
load_media = load_audio


def save_audio(
    audio: np.ndarray,
    file_path: Union[str, Path, io.BytesIO],
    sample_rate: int = 16000,
    format: str = "WAV",
) -> None:
    """Save audio samples to a file or in-memory buffer.

    Args:
        audio: Audio samples as numpy array.
        file_path: Output file path, or BytesIO buffer for in-memory saving.
        sample_rate: Sample rate in Hz.
        format: Output format (default WAV).
    """
    # If it's a BytesIO buffer, write directly to it
    if isinstance(file_path, io.BytesIO):
        sf.write(file_path, audio, sample_rate, format=format)
        return

    file_path = Path(file_path)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(file_path), audio, sample_rate, format=format)


def normalize_audio(audio: np.ndarray, target_db: float = -20.0) -> np.ndarray:
    """Normalize audio to a target RMS level.

    Args:
        audio: Input audio samples.
        target_db: Target RMS level in dB.

    Returns:
        Normalized audio samples.
    """
    rms = np.sqrt(np.mean(audio ** 2))
    if rms < 1e-10:
        return audio
    target_rms = 10 ** (target_db / 20)
    return audio * (target_rms / rms)


def compute_rms(audio: np.ndarray) -> float:
    """Compute the RMS (Root Mean Square) energy of an audio signal."""
    return float(np.sqrt(np.mean(audio ** 2)))


def compute_snr(signal: np.ndarray, noise: np.ndarray) -> float:
    """Compute Signal-to-Noise Ratio in dB.

    Args:
        signal: Clean signal.
        noise: Noise signal.

    Returns:
        SNR value in dB. Higher is better.
    """
    signal_power = np.mean(signal ** 2)
    noise_power = np.mean(noise ** 2)
    if noise_power < 1e-15:
        return float("inf")
    return float(10 * np.log10(signal_power / noise_power))


def mix_audio_with_noise(
    clean: np.ndarray,
    noise: np.ndarray,
    snr_db: float,
) -> np.ndarray:
    """Mix clean audio with noise at a specified SNR.

    Args:
        clean: Clean audio signal.
        noise: Noise signal.
        snr_db: Desired Signal-to-Noise Ratio in dB.

    Returns:
        Mixed (noisy) audio.
    """
    # Ensure same length
    if len(noise) < len(clean):
        repeats = int(np.ceil(len(clean) / len(noise)))
        noise = np.tile(noise, repeats)
    noise = noise[: len(clean)]

    clean_rms = np.sqrt(np.mean(clean ** 2))
    noise_rms = np.sqrt(np.mean(noise ** 2))

    if noise_rms < 1e-10:
        return clean

    target_noise_rms = clean_rms / (10 ** (snr_db / 20))
    scaled_noise = noise * (target_noise_rms / noise_rms)

    return clean + scaled_noise


def plot_waveform(
    audio: np.ndarray,
    sr: int,
    title: str = "Waveform",
    ax: Optional[plt.Axes] = None,
    color: str = "steelblue",
) -> plt.Axes:
    """Plot audio waveform.

    Args:
        audio: Audio samples.
        sr: Sample rate.
        title: Plot title.
        ax: Optional matplotlib axes.
        color: Waveform color.

    Returns:
        Matplotlib axes.
    """
    if ax is None:
        _, ax = plt.subplots(figsize=(12, 3))

    time = np.linspace(0, len(audio) / sr, len(audio))
    ax.plot(time, audio, color=color, linewidth=0.5)
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Amplitude")
    ax.set_title(title)
    ax.set_xlim(0, time[-1])
    return ax


def plot_spectrogram(
    audio: np.ndarray,
    sr: int,
    title: str = "Spectrogram",
    ax: Optional[plt.Axes] = None,
    n_fft: int = 512,
    hop_length: int = 128,
) -> plt.Axes:
    """Plot mel-spectrogram of audio.

    Args:
        audio: Audio samples.
        sr: Sample rate.
        title: Plot title.
        ax: Optional matplotlib axes.
        n_fft: FFT window size.
        hop_length: Hop length for STFT.

    Returns:
        Matplotlib axes.
    """
    if ax is None:
        _, ax = plt.subplots(figsize=(12, 4))

    S = librosa.feature.melspectrogram(
        y=audio, sr=sr, n_fft=n_fft, hop_length=hop_length
    )
    S_db = librosa.power_to_db(S, ref=np.max)

    img = librosa.display.specshow(
        S_db, sr=sr, hop_length=hop_length, x_axis="time", y_axis="mel", ax=ax
    )
    plt.colorbar(img, ax=ax, format="%+2.0f dB")
    ax.set_title(title)
    return ax


def compare_audio(
    original: np.ndarray,
    processed: np.ndarray,
    sr: int,
    title_original: str = "Original",
    title_processed: str = "Processed",
) -> plt.Figure:
    """Create a side-by-side comparison of original and processed audio.

    Args:
        original: Original audio samples.
        processed: Processed audio samples.
        sr: Sample rate.
        title_original: Title for original audio.
        title_processed: Title for processed audio.

    Returns:
        Matplotlib figure.
    """
    fig, axes = plt.subplots(2, 2, figsize=(14, 8))

    plot_waveform(original, sr, title_original, ax=axes[0, 0])
    plot_waveform(processed, sr, title_processed, ax=axes[0, 1])
    plot_spectrogram(original, sr, f"{title_original} Spectrogram", ax=axes[1, 0])
    plot_spectrogram(processed, sr, f"{title_processed} Spectrogram", ax=axes[1, 1])

    plt.tight_layout()
    return fig


def get_audio_duration(file_path: Union[str, Path]) -> float:
    """Get the duration of an audio file in seconds."""
    return float(librosa.get_duration(path=str(file_path)))


def trim_silence(
    audio: np.ndarray,
    sr: int,
    top_db: int = 20,
    frame_length: int = 2048,
    hop_length: int = 512,
) -> np.ndarray:
    """Trim leading and trailing silence from audio.

    Args:
        audio: Input audio.
        sr: Sample rate.
        top_db: Threshold in dB below reference to consider as silence.
        frame_length: Frame length for energy computation.
        hop_length: Hop length.

    Returns:
        Trimmed audio.
    """
    trimmed, _ = librosa.effects.trim(
        audio, top_db=top_db, frame_length=frame_length, hop_length=hop_length
    )
    return trimmed


def segment_audio(
    audio: np.ndarray,
    sr: int,
    segment_duration: float = 30.0,
    overlap: float = 1.0,
) -> list:
    """Segment long audio into overlapping chunks.

    Args:
        audio: Input audio.
        sr: Sample rate.
        segment_duration: Duration of each segment in seconds.
        overlap: Overlap between segments in seconds.

    Returns:
        List of audio segments.
    """
    segment_samples = int(segment_duration * sr)
    overlap_samples = int(overlap * sr)
    step = segment_samples - overlap_samples

    segments = []
    for start in range(0, len(audio) - overlap_samples, step):
        end = min(start + segment_samples, len(audio))
        segments.append(audio[start:end])
        if end >= len(audio):
            break

    return segments
