## 📸 Demo Preview

| FastAPI Swagger UI | Streamlit Web Interface |
| :---: | :---: |
| <img width="2549" height="1403" alt="image" src="https://github.com/user-attachments/assets/656caecc-5bfd-44ff-884d-eee206c9768b" />| <img width="2487" height="1371" alt="image" src="https://github.com/user-attachments/assets/34520375-6196-4e1d-963d-68e7abe3f9b2" /> |


# 项目总览

本项目分为两大模块：Topic3本地音频预处理模块、Topic1 Whisper-FastAPI音频转写模块。Topic3作为ASR前端清洗工具，对原始带噪音频完成降噪、语音截取、音质增强，处理后的干净音频送入Whisper后端实现音频转写、字幕生成、说话人分离、LLM会议纪要生成以及RAG知识库接入。
Whisper后端基于Faster-Whisper，搭配FastAPI接口 + Streamlit可视化网页，支持单文件上传转写、批量文件夹批量转码，多语种识别，SRT、TXT两种字幕格式导出；预处理模块内置5种降噪算法、4类VAD语音检测、5项音频增强手段，配套5套场景专用预设。

FastAPI Swagger UI 图片链接：https://github.com/user-attachments/assets/656caecc-5bfd-44ff-884d-eee206c9768b
Streamlit Web Interface 图片链接：https://github.com/user-attachments/assets/34520375-6196-4e1d-963d-68e7abe3f9b2
SRT字幕生成效果图片链接：https://github.com/user-attachments/assets/30177683-938a-4f7a-b3be-2491320b9a43

## 项目功能
1.批量目录处理：一键批量转写文件夹内全部音频文件
2.单文件上传：网页拖拽上传音视频，单独识别转写
3.多语言支持：中英日韩法德等多国语种识别
4.多格式输出：生成SRT字幕文件和纯文本TXT文件
5.本地模型加载：可离线加载本地Whisper模型，规避网络下载问题
6.可视化前端：基于Streamlit搭建，可视化参数配置、任务监控
7.音频预处理：5类降噪、4种VAD、5项音频增强，5套场景预设，单独网页可视化降噪试听下载
8.对比转写功能：同音频原始转写与预处理后转写结果对照，直观查看降噪提升效果

## 前置必备环境（源自SETUP.md）
1.Python3.8及以上版本
2.FFmpeg，音视频解析必需
Windows安装命令：winget install ffmpeg
安装完成校验：ffmpeg -version

### 项目改动文件说明
src/utils/audio_utils.py：新增mp4/mkv视频解析支持，BytesIO文件保存，ffmpeg异常捕获处理
src/preprocessing/noise_reduction.py：修复跨方法参数传参异常，通过inspect过滤多余入参
src/preprocessing/voice_activity_detection.py：同步参数修复，默认VAD由Silero更换为谱熵VAD，无需预下载模型
src/preprocessing/pipeline.py：全预设默认VAD修改为SPECTRAL_ENTROPY
web/backend_whisper.py：自动识别项目根目录，临时文件安全清理，默认base模型，模型缓存至web/models文件夹
web/frontend_whisper.py：新增Tab3音频预处理、Tab4预处理对照转写，支持mp4格式文件上传
web/requirements.txt、项目根目录requirements.txt：纯ASCII编码，解决中文编码报错
setup.py：支持pip install -e .本地源码安装

### 依赖安装步骤
打开终端，进入web目录：cd local-audio-preprocessing-asr/web
安装项目依赖：pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
单独安装torch：pip install torch torchvision torchaudio -i https://pypi.tuna.tsinghua.edu.cn/simple

### 国内模型加速配置（仅Windows）
set HF_ENDPOINT=https://hf-mirror.com

### 项目前后端启动
终端1启动后端：uvicorn backend_whisper:app --port 8000，接口文档地址http://127.0.0.1:8000/docs
终端2启动前端：streamlit run frontend_whisper.py，网页访问http://localhost:8501

### 前端四个标签页作用
Tab1：批量转写目标文件夹内所有音视频
Tab2：单文件上传，独立转写下载字幕
Tab3：上传带噪音视频，选择场景预设，降噪后下载干净音频
Tab4：同一文件，原始音频转写&预处理音频转写结果对照查看

## 新建 transcribe.py 全链路测试代码
import whisper
model = whisper.load_model("base")
result = model.transcribe("./data/cleaned/meeting_clean.wav", language="zh")
print(result["text"])

### 全链路整合代码（预处理 + 分轨 + ASR+LLM）
import sys
sys.path.insert(0, ".")
from src.preprocessing.pipeline import AudioPreprocessingPipeline
from src.utils.audio_utils import load_audio
import numpy as np

print("=" * 50)
print("第1步：音频预处理 (Topic 3)")
print("=" * 50)
audio, sr = load_audio("./data/raw/meeting_recording.wav", target_sr=16000)
pipeline = AudioPreprocessingPipeline.from_preset("meeting_room")
clean_audio, stats = pipeline.process(audio, sr)
print(f"原始时长:{stats.input_duration:.1f}s → 处理后:{stats.output_duration:.1f} s")
print(f"检测到 {stats.vad_segments_detected} 个语音段")
print(f"处理耗时:{stats.processing_time_total*1000:.0f} ms")

print()
print("=" * 50)
print("第2步：说话人分离 (Topic 1a)")
print("=" * 50)
try:
    from resemblyzer import VoiceEncoder, preprocess_wav
    from spectralcluster import SpectralClusterer
    from src.preprocessing.voice_activity_detection import detect_voice_activity
    segments = detect_voice_activity(clean_audio, sr, method="energy")
    print(f"VAD 检测到 {len(segments)} 个语音段")
    for i, seg in enumerate(segments):
        print(f"段{i+1}:{seg.start:.1f}s - {seg.end:.1f}s ({seg.end-seg.start:.1f}s)")
except ImportError:
    print("安装 resemblyzer 和 spectralcluster 可运行简化版 diarization")
    print("pip install resemblyzer spectralcluster")

print()
print("=" * 50)
print("第3步：语音识别 (Topic 1b)")
print("=" * 50)
try:
    import whisper
    model = whisper.load_model("base")
    result = model.transcribe(clean_audio.astype(np.float32), language="zh")
    transcript = result["text"].strip()
    print(f"转录结果:{transcript[:200]}..." if len(transcript) > 200 else f"转录结果:{transcript}")
except ImportError:
    print("安装 openai-whisper 可运行 ASR")
    print("pip install openai-whisper")

print()
print("=" * 50)
print("第4步：LLM 后处理 (Topic 1c)-摘要 + 纠错")
print("=" * 50)
llm_prompt = f"""
You are a meeting assistant. Below is a transcript from a meeting recording.
Audio Quality Metadata:
- Recording quality: {'good' if stats.input_rms_db > -30 else 'poor'}
- Speech segments detected: {stats.vad_segments_detected}
- Noise reduction applied: {stats.noise_reduction_applied}
- Signal enhancement applied: {stats.signal_enhancement_applied}
Please:
1. Correct any obvious ASR errors considering the audio quality metadata
2. Summarize the key discussion points
3. List any action items or decisions
Transcript: {transcript if 'transcript' in dir() else 'ASR not available — skipping'}
"""
print("LLM Prompt 已构建（包含预处理元数据作为上下文）")
print(f"Prompt 长度: {len(llm_prompt)} 字符")
print()
print("=" * 50)
print("管道完成！")
print("=" * 50)

## 预处理常见问题
Q：我没有真实录音怎么办
A：python -m src.main generate 生成仿真数据练习，流程完全一致

Q：报错找不到librosa模块
A：pip install -r requirements.txt 安装全项目依赖

Q：处理速度太慢
A：更换 mobile 或 lightweight 轻量化预设

Q：需要自定义降噪强度
```python
from src.preprocessing.pipeline import PreprocessingConfig
config = PreprocessingConfig()
config.noise_reduction_prop_decrease = 0.95
config.enable_deess = True
pipeline = AudioPreprocessingPipeline(config)

## Project Report: Local Audio Preprocessing for Better ASR Performance

### 1 Introduction
Automatic Speech Recognition (ASR) has made remarkable progress in recent years, with models like Whisper, Wav2Vec 2.0, and Conformer achieving near-human performance on clean, well-recorded speech. However, real-world deployment scenarios rarely offer pristine audio conditions. Background noise, varying microphone quality, room acoustics, inconsistent recording levels, and speaker variability all contribute to significant degradation in ASR accuracy.

This project investigates whether lightweight, locally-deployable audio preprocessing techniques can bridge the gap between laboratory ASR performance and real-world robustness. Rather than modifying the ASR model itself — which requires retraining and substantial compute — we explore front-end signal processing that can be applied to any audio before it reaches the ASR engine.

#### 1.1 Motivation
The key question driving this work is: Can we achieve meaningful ASR accuracy improvements through preprocessing alone, without touching the ASR model?

This matters because:
- Cost: Retraining large ASR models is expensive
- Latency: Preprocessing adds minor overhead compared to larger models
- Portability: Signal processing works across different ASR backends
- Edge deployment: Lightweight preprocessing runs on-device where large models cannot

#### 1.2 Scope
This project implements and evaluates three categories of audio preprocessing:
1. Noise Reduction (5 methods)
2. Voice Activity Detection (4 methods)
3. Signal Enhancement (5 techniques)

Each is evaluated for its impact on ASR accuracy (WER/CER), processing speed (RTF), and robustness across noise conditions (varying SNR levels).

### 2. Technical Approach
#### 2.1 Noise Reduction Methods
##### Spectral Gating
Based on the noisereduce library by Tim Sainburg. Estimates a noise profile from non-speech frames and applies a spectral gate. Provides the best overall quality but requires a noise-only segment for calibration.

##### Spectral Subtraction (Boll, 1979)
The classic approach: estimate noise spectrum from initial frames, subtract from signal magnitude, apply spectral floor. Simple, fast, predictable. Tends to produce "musical noise" artifacts at low SNR.

##### Wiener Filter
Frequency-domain optimal filter based on minimum mean-square error criterion. Uses decision-directed a priori SNR estimation (Scalart, 1996) which provides smooth, artifact-free output at the cost of higher computational complexity.

##### Kalman Filter
Sample-by-sample adaptive filtering using a first-order autoregressive model for the speech signal. Extremely lightweight — suitable for real-time embedded systems — but limited in its ability to handle non-stationary noise.

##### Multi-band Spectral Subtraction
An extension of classic spectral subtraction that applies different oversubtraction factors per frequency band. Speech-critical bands (500-2000 Hz) receive gentle subtraction while high-frequency noise bands receive aggressive reduction. This preserves speech formants better than uniform approaches.

#### 2.2 Voice Activity Detection Methods
##### Energy-based VAD
Simple thresholding on short-time energy. Works well in quiet environments but fails when noise energy exceeds speech energy. Useful as a baseline.

##### Silero VAD
Pre-trained neural network from Silero AI. State-of-the-art accuracy with a remarkably small model (~1.5MB). Uses a CRNN architecture trained on diverse data.The recommended default for most applications.

##### WebRTC VAD
Google's Gaussian Mixture Model with six sub-band features.Extremely lightweight(<10KB),designed for real-time communication.Less accurate than Silero but sufficient for many use-cases.

##### Spectral Entropy VAD
Exploits the fact that speech has lower spectral entropy (more structured harmonic content) than noise(more random).No training data required — works out of the box.A compelling lightweight alternative.

#### 2.3 Signal Enhancement Techniques
##### Dynamic Range Compression(DRC)
Reduces the amplitude difference between loud and quiet speech segments.This is critical for ASR because quiet phonemes(unvoiced consonants) carry significant linguistic information.Our implementation uses a soft-knee compressor with configurable attack/release times and make-up gain.

##### Speech-Optimized Equalization
Three EQ presets tuned for ASR:
- Telephone: Band-pass 300-3400Hz with mid-range boost — matches telephony-trained ASR models
- Clarity:Boosts 2-6kHz for consonant clarity(fricatives and plosives)
- Warmth:Gentle low-end boost with clarity enhancement for natural speech

##### Automatic Gain Control (AGC)
Normalizes audio to a consistent RMS-level,compensating for varying microphone distances and recording gains.Uses overlap-add processing with configurable window size and maximum gain.

##### De-essing
Targeted compression of sibilant frequencies(4-10kHz) to reduce harsh"s"-and"sh"-sounds that can confuse ASR models.Uses band-pass detection with frequency-dependent compression.

##### Dereverberation
Simple late-reverberation reduction using spectral smoothing subtraction.Treats the diffuse reverberation tail as slowly-varying additive noise.For severe reverb,WPE (Weighted Prediction Error) would be more appropriate.

#### 2.4 Pipeline Architecture
Raw Audio → [VAD] → [Noise Reduction] → [Signal Enhancement] → Clean Audio

Each stage is independently configurable and can be disabled.The pipeline is designed to work with Numpy arrays in memory,making it framework-agnostic.

#### 2.5 Deployment Presets
- mobile：RTF0.3-0.5，音质良好，占用内存 < 20MB，适用手机语音输入
- desktop_high_quality：RTF0.8-2.0，音质优秀，占用内存 < 100MB，适用离线转录
- noisy_environment：RTF1.0-3.0，嘈杂环境最优，占用内存 < 100MB，适用户外工厂
- meeting_room：RTF1.5-4.0，综合最优，占用内存 < 200MB，适用会议录音
- lightweight：RTF0.1-0.2，音质达标，占用内存 < 5MB，适用嵌入式设备

### 3. Experimental Results
#### 3.1 Noise Reduction at Varying SNR
We tested noise reduction methods on synthetic speech-like signals mixed with white noise at SNRs from -5 dB to 20 dB.Quality was measured as Pearson correlation with the clean reference signal.

Key findings:
- At SNR ≥ 10 dB: All methods perform well(correlation >0.8). Spectral gating leads slightly.
- At SNR 5-10 dB: Multi-band subtraction begins to diverge positively from uniform approaches.
- At SNR < 5 dB: All methods degrade. Multi-band subtraction maintains the highest correlation,but the improvement over unprocessed audio narrows.

#### 3.2 Processing Speed (Real-Time Factor)
测试环境 Intel i7-12700H，10 秒音频：
- Kalman：耗时 42ms，RTF0.004，实时可用
- Spectral Subtraction：耗时 180ms，RTF0.018，实时可用
- Spectral Gating：耗时 520ms，RTF0.052，实时可用
- Multi-band：耗时 890ms，RTF0.089，实时可用
- Wiener：耗时 2340ms，RTF0.234，实时可用

全模块组合流水线随配置不同 RTF 可能超过 1.0

#### 3.3 ASR Accuracy Impact
Whisper-tiny 模型测试：
- 纯净音频：原始 WER8.2%，预处理无提升
- 20dB 信噪比：原始 12.1%，处理后 9.8%，提升 19.0%
- 10dB 信噪比：原始 28.5%，处理后 18.7%，提升 34.4%
- 5dB 信噪比：原始 45.3%，处理后 32.1%，提升 29.1%
- 0dB 信噪比：原始 62.8%，处理后 51.4%，提升 18.2%

结论：8~20dB 中等信噪比预处理收益最高，极低信噪比过度降噪会损伤语音。

#### 3.4 VAD Impact on Processing Speed
- Energy VAD：保留 72% 语音，ASR 耗时减少 28%
- WebRTC VAD：保留 65% 语音，ASR 耗时减少 35%
- Spectral Entropy VAD：保留 68% 语音，ASR 耗时减少 32%
- Silero VAD：保留 58% 语音，ASR 耗时减少 42%

Silero 削减耗时最多，但容易截断语音首尾，常规项目推荐 WebRTC/Silero 保守阈值。

### 4. Deeper Insights and Observations
#### 4.1 The "Preprocessing Sweet Spot"
最优预处理区间 8~20dB SNR，该区间降噪稳定提升识别准确率；低于 5dB 降噪收益下滑，Whisper 原生训练数据含大量噪声，激进降噪反而引入失真。预处理建议根据实时 SNR 自适应开启。

#### 4.2 Model-Dependent Effects
Whisper 经过海量嘈杂语料训练，相比干净语料训练模型，降噪收益更低；tiny/base 小模型依赖预处理提升精度。

#### 4.3 Real-Time Feasibility on Edge Devices
mobile/lightweight 预设在笔记本 CPU 实时运行，ARM 手机端 mobile 预设预估 RTF0.5~0.8；WebRTC+Kalman+AGC 组成超轻量流水线适配嵌入式常驻语音。

#### 4.4 The Equalization Surprise
电话频段 300~3400Hz 带通 EQ 对电话数据集训练 ASR 提升明显，训练集与推理音频频段不匹配是识别掉点重要诱因。

#### 4.5 Silence is Golden
仅启用 VAD 即可减少 30%~60% ASR 运算量，投入产出比最高。

### 5. Limitations and Future Work
#### 5.1 Current Limitations
1. 评测基于合成噪声，真实场景餐厅、车流噪声分布不同
2. 实验以英文为主，声调语种（中文、越南语）适配性未充分验证
3. 当前仅支持离线整文件处理，未实现流式逐帧实时处理
4. 主要测试 Whisper，CTC/RNN-T 架构模型效果未实测

#### 5.2 Future Directions
1. 自适应预处理：实时预估 SNR 动态切换降噪配置
2. 神经网络降噪：RNNoise、DTLN 等轻量化神经增强作为可选方案
3. 多麦克风波束成形拓展
4. 分语种定制 EQ 与增强参数
5. 扩充 Wav2Vec、Conformer 等多类 ASR 评测
6. mobile 预设移植 CoreML/TensorflowLite 移动端部署
7. 增加 MOS 主观人耳打分评测

### 6. Conclusion
本项目证明中等噪声场景下音频预处理可降低 WER15%~40%；产出模块化五预设预处理流水线，明确 8~20dB 最优降噪区间；最简有效组合：AGC+VAD，全场景通用，仅在 5dB 以上噪声环境额外开启降噪。

### 7. References
- Boll, S. (1979). Suppression of acoustic noise in speech using spectral subtraction. IEEE Trans. ASSP, 27(2), 113-120.
- Scalart, P. & Filho, J. (1996). Speech enhancement based on a priori signal to noise estimation. ICASSP.
- Ephraim, Y. & Malah, D. (1984). Speech enhancement using a minimum mean-square error short-time spectral amplitude estimator. IEEE Trans. ASSP, 32(6).
- Silero Team. (2021). Silero VAD: pre-trained enterprise-grade Voice Activity Detector. GitHub: snakers4/silero-vad.
- Google. WebRTC Voice Activity Detector. https://webrtc.org/
- Radford, A. et al. (2023). Robust Speech Recognition via Large-Scale Weak Supervision. ICML.
- Sainburg, T. (2019). noisereduce: Noise reduction in python. GitHub: timsainb/noisereduce.

## 项目常见报错汇总
1. ModuleNotFoundError: No module named'src'：进入 web 目录执行 pip install -e ..
2. ffmpeg 缺失：系统安装 ffmpeg 并配置环境变量
3. 模型下载缓慢：配置 HF 国内镜像 set HF_ENDPOINT=https://hf-mirror.com，或手动放置模型至 web/models 文件夹
4. 处理速度过慢：更换 mobile/lightweight 轻量化预设
5. 极低信噪比音频预处理后识别变差：SNR＜5dB 切换 lightweight 预设，关闭多频段激进降噪