# Local Audio Preprocessing for Better ASR Performance

A comprehensive audio preprocessing pipeline designed to improve Automatic Speech Recognition (ASR) accuracy through intelligent local signal processing. This project implements and evaluates multiple preprocessing techniques — noise reduction, voice activity detection, and signal enhancement — comparing their impact on downstream ASR performance across varied acoustic conditions.

## Project Overview

Modern ASR systems like Whisper, DeepSpeech, and Wav2Vec perform remarkably well on clean audio, but their accuracy degrades significantly in real-world conditions: background noise, varying microphone quality, room reverberation, and inconsistent recording levels. This project asks: **can we bridge that gap with lightweight, locally-deployable preprocessing?**

### What This Project Does

1. **Noise Reduction** — 5 methods (spectral gating, spectral subtraction, Wiener filter, Kalman filter, multi-band subtraction) tuned for speech preservation
2. **Voice Activity Detection** — 4 methods (energy-based, Silero neural VAD, WebRTC VAD, spectral entropy) to extract speech segments
3. **Signal Enhancement** — DRC, parametric EQ, AGC, de-essing, dereverberation to normalize and clarify speech
4. **Configurable Pipeline** — 5 presets optimized for different deployment scenarios (mobile, desktop, noisy environments, meetings, lightweight)
5. **Benchmarking Framework** — Systematic comparison of preprocessing impact on ASR accuracy (WER/CER/MER/WIL)

## Quick Start

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd local-audio-preprocessing-asr

# Install dependencies
pip install -r requirements.txt

# For GPU acceleration (optional)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
```

### Basic Usage

```python
from src.preprocessing.pipeline import AudioPreprocessingPipeline

# Create a pipeline with a preset configuration
pipeline = AudioPreprocessingPipeline.from_preset("mobile")

# Process audio
import librosa
audio, sr = librosa.load("noisy_recording.wav", sr=16000)
processed, stats = pipeline.process(audio, sr)

# Save result
import soundfile as sf
sf.write("clean_recording.wav", processed, sr)

print(f"WER improvement: check stats.to_dict()")
```

### CLI Usage

```bash
# Process a file with the mobile-optimized preset
python -m src.main process noisy_input.wav clean_output.wav --preset mobile

# Run the full benchmark suite
python -m src.main benchmark --output-dir ./results

# Generate synthetic test data
python -m src.main generate --output-dir ./data/synthetic

# Run interactive demonstration
python -m src.main demo
```

## Project Structure

```
local-audio-preprocessing-asr/
├── src/
│   ├── __init__.py                    # Package exports
│   ├── main.py                        # CLI entry point & demo
│   ├── preprocessing/
│   │   ├── __init__.py
│   │   ├── noise_reduction.py         # 5 denoising algorithms
│   │   ├── voice_activity_detection.py # 4 VAD methods
│   │   ├── signal_enhancement.py      # EQ, DRC, AGC, de-essing
│   │   └── pipeline.py                # Unified pipeline + presets
│   ├── evaluation/
│   │   ├── __init__.py
│   │   ├── metrics.py                 # WER, CER, MER, WIL
│   │   └── benchmark.py               # Systematic ASR benchmarking
│   └── utils/
│       ├── __init__.py
│       └── audio_utils.py             # I/O, visualization, mixing
├── notebooks/
│   └── experiments.ipynb              # Experimental analysis notebook
├── tests/
│   ├── __init__.py
│   └── test_preprocessing.py          # Unit tests (30+ test cases)
├── requirements.txt
├── README.md
└── PROJECT_REPORT.md                  # Detailed technical report
```

## Available Presets

| Preset | VAD | Noise Reduction | Enhancement | Best For |
|--------|-----|-----------------|-------------|----------|
| `mobile` | WebRTC | Spectral Subtraction | DRC + EQ + AGC | Smartphone apps, edge devices |
| `desktop_high_quality` | Silero | Spectral Gating | DRC + EQ + AGC + De-ess | Desktop apps, offline transcription |
| `noisy_environment` | Silero | Multi-band | DRC + EQ + AGC | Factory floors, outdoor, crowds |
| `meeting_room` | Silero | Wiener | DRC + EQ + AGC + De-ess + Dereverb | Conference rooms, multi-speaker |
| `lightweight` | None | Kalman | AGC only | Minimum latency, embedded systems |

## Key Findings

From our experimental analysis (see `notebooks/experiments.ipynb`):

1. **WER improvement of 15-40%** is achievable through preprocessing in moderate noise (SNR > 10 dB)
2. **Spectral gating** provides the best quality-noise trade-off for most scenarios
3. **VAD alone** can reduce ASR processing time by 30-60% by removing silence
4. **Real-time processing** is achievable on mobile devices using the `lightweight` or `mobile` presets
5. **AGC** provides the most consistent benefit across all noise conditions

## Testing

```bash
# Run all tests
python -m pytest tests/ -v

# Or with unittest
python -m unittest discover tests/
```

## Dependencies

Core: `librosa`, `numpy`, `scipy`, `soundfile`
Noise reduction: `noisereduce`
VAD: `silero-vad`, `webrtcvad` (optional for specific methods)
ASR evaluation: `openai-whisper`, `faster-whisper`
Notebook: `jupyter`, `matplotlib`, `seaborn`

See `requirements.txt` for complete list.

## License

This project is created for educational purposes as part of a machine learning course project.

## References

- Boll, S. (1979). "Suppression of acoustic noise in speech using spectral subtraction"
- Scalart, P. et al. (1996). "Speech enhancement based on a priori signal to noise estimation"
- Silero VAD: https://github.com/snakers4/silero-vad
- WebRTC VAD: https://github.com/wiseman/py-webrtcvad
- OpenAI Whisper: https://github.com/openai/whisper
- Sainburg, T. (2019). "noisereduce: Noise reduction in python"
