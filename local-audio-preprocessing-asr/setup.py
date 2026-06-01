from setuptools import setup, find_packages

setup(
    name="audio-preprocessing-asr",
    version="1.0.0",
    description="Local audio preprocessing pipeline for better ASR performance",
    author="ML Course Project",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[
        "numpy",
        "scipy",
        "librosa",
        "soundfile",
        "matplotlib",
    ],
)
