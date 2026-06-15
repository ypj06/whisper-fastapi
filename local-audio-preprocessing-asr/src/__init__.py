"""Audio preprocessing for better ASR performance."""

from .preprocessing.pipeline import (
    AudioPreprocessingPipeline,
    PreprocessingConfig,
    VadMethod,
    NoiseReductionMethod,
    PRESETS,
    preprocess_for_asr,
)
from .preprocessing.noise_reduction import reduce_noise
from .preprocessing.voice_activity_detection import detect_voice_activity
from .preprocessing.signal_enhancement import enhance_signal

__version__ = "1.0.0"
