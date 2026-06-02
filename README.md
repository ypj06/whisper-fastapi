## 📸 Demo Preview

| FastAPI Swagger UI | Streamlit Web Interface |
| :---: | :---: |
| <img width="2549" height="1403" alt="image" src="https://github.com/user-attachments/assets/656caecc-5bfd-44ff-884d-eee206c9768b" />| <img width="2487" height="1371" alt="image" src="https://github.com/user-attachments/assets/34520375-6196-4e1d-963d-68e7abe3f9b2" /> |

项目总览
本项目分为两大模块：Topic3 本地音频预处理模块、Topic1 Whisper-FastAPI 音视频转写模块。Topic3 作为 ASR 前端清洗工具，对原始带噪音频完成降噪、语音截取、音质增强，处理后的干净音频送入 Whisper 后端实现音视频转写、字幕生成、说话人分离、LLM 会议纪要生成以及 RAG 知识库接入。
Whisper 后端基于 Faster-Whisper，搭配 FastAPI 接口 + Streamlit 可视化网页，支持单文件上传转写、批量文件夹批量转码，多语种识别，SRT、TXT 两种字幕格式导出；预处理模块内置 5 种降噪算法、4 类 VAD 语音检测、5 项音频增强手段，配套 5 套场景专用预设。
项目 Demo 预览
FastAPI Swagger UI 图片链接：https://github.com/user-attachments/assets/656caecc-5bfd-44ff-884d-eee206c9768b
Streamlit Web Interface 图片链接：https://github.com/user-attachments/assets/34520375-6196-4e1d-963d-68e7abe3f9b2
SRT 字幕生成效果图片链接：https://github.com/user-attachments/assets/30177683-938a-4f7a-b3be-2491320b9a43
项目功能
1. 批量目录处理：一键批量转写文件夹内全部音视频文件
2. 单文件上传：网页拖拽上传音视频，单独识别转写
3. 多语言支持：中英日韩法德等多国语种识别
4. 多格式输出：生成 SRT 字幕文件和纯文本 TXT 文件
5. 本地模型加载：可离线加载本地 Whisper 模型，规避网络下载问题
6. 可视化前端：基于 Streamlit 搭建，可视化参数配置、任务监控
7. 音频预处理：5 类降噪、4 种 VAD、5 项音频增强，5 套场景预设，单独网页可视化降噪试听下载
8. 对比转写功能：同音频原始转写与预处理后转写结果对照，直观查看降噪提升效果
项目部署指南（源自 SETUP.md）
前置必备环境
1.Python3.8 及以上版本
2.FFmpeg，音视频解析必需
Windows 安装命令：winget install ffmpeg
安装完成校验：ffmpeg -version
项目改动文件说明
src/utils/audio_utils.py：新增 mp4/mkv 视频解析支持，BytesIO 文件保存，ffmpeg 异常捕获处理
src/preprocessing/noise_reduction.py：修复跨方法参数传参异常，通过 inspect 过滤多余入参
src/preprocessing/voice_activity_detection.py：同步参数修复，默认 VAD 由 Silero 更换为谱熵 VAD，无需预下载模型
src/preprocessing/pipeline.py：全预设默认 VAD 修改为 SPECTRAL_ENTROPY
web/backend_whisper.py：自动识别项目根目录，临时文件安全清理，默认 base 模型，模型缓存至 web/models 文件夹
web/frontend_whisper.py：新增 Tab3 音频预处理、Tab4 预处理对照转写，支持 mp4 格式文件上传
web/requirements.txt、项目根目录 requirements.txt：纯 ASCII 编码，解决中文编码报错
setup.py：支持 pip install -e . 本地源码安装
依赖安装步骤
打开终端，进入 web 目录：cd local-audio-preprocessing-asr/web
安装项目依赖：pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
单独安装 torch：pip install torch torchvision torchaudio -i https://pypi.tuna.tsinghua.edu.cn/simple
国内模型加速配置（仅 Windows）
set HF_ENDPOINT=https://hf-mirror.com
项目前后端启动
终端 1 启动后端：uvicorn backend_whisper:app --port 8000，接口文档地址http://127.0.0.1:8000/docs
终端 2 启动前端：streamlit run frontend_whisper.py，网页访问http://localhost:8501
前端四个标签页作用
Tab1：批量转写目标文件夹内所有音视频
Tab2：单文件上传，独立转写下载字幕
Tab3：上传带噪音视频，选择场景预设，降噪后下载干净音频
Tab4：同一文件，原始音频转写 & 预处理音频转写结果对照查看
一键启动速查脚本
#后端终端
cd local-audio-preprocessing-asr/web
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
pip install torch torchvision torchaudio -i https://pypi.tuna.tsinghua.edu.cn/simple
set HF_ENDPOINT=https://hf-mirror.com
uvicorn backend_whisper:app --port 8000
# 前端终端
cd local-audio-preprocessing-asr/web
streamlit run frontend_whisper.py
# 浏览器访问：http://localhost:8501
Topic3 实际操作完整流程（OPERATIONAL_WALKTHROUGH 原文）
#实际操作完整流程：Topic 3 作为 Topic 1 的前端清洗工
## 推荐方式：Web 界面操作（无需命令行）
cd D:\claude\work\local-audio-preprocessing-asr
streamlit run app.py
浏览器自动打开http://localhost:8501，网页操作步骤：
1. 上传音频：拖拽或点击上传录音，支持 WAV/MP3/M4A/FLAC
2. 选择预设：侧边栏下拉选择 mobile/meeting_room 等场景
3. 点击 Run Preprocessing 开始处理
4. 查看波形频谱原图与处理后对比图
5. 内嵌播放器试听降噪前后音频
6. 侧边栏下载处理完成的干净音频
前后端分工说明：所有音频处理（降噪、VAD、信号增强）必须在 Python 后端运行，librosa/scipy/noisereduce 为 C 拓展库无法在浏览器运行，Streamlit 自动搭建后端服务、前端渲染页面。
## 命令行备选操作
### 前置准备
cd D:\claude\work\local-audio-preprocessing-asr
pip install torch torchvision torchaudio -i https://pypi.tuna.tsinghua.edu.cn/simple
python -c "from src.preprocessing.pipeline import AudioPreprocessingPipeline; print (' 环境就绪 ')"
## 流程一：无真实音频，生成测试数据
### 第 1 步生成模拟多说话人会议音频
python -m src.main generate --output-dir ./data/test
生成 8 份不同信噪比、噪声类型的 wav 测试音频，存放至 data/test 目录。
### 第 2 步运行 demo 查看预处理效果
python -m src.main demo
执行流程：1 生成测试音频；2 五种预设依次处理音频并输出耗时；3 生成 demo_comparison.png 对比图谱；4 输出降噪前后 WER 改善数据；5 各预设 RTF 实时性数据；运行后项目根目录生成 demo_comparison.png。
### 第 3 步单文件使用会议室预设处理
python -m src.main process ./data/test/white_noise_10db.wav ./data/test/cleaned_10db.wav --preset meeting_room
运行输出加载路径、配置、耗时、文件保存地址、各项处理统计参数，处理后 cleaned_10db.wav 保存至 test 文件夹。
### 第 4 步批量处理全部测试音频
mkdir ./data/cleaned
for % f in (.\data\test*.wav) do python -m src.main process "% f" ".\data\cleaned%~nxf" --preset meeting_room
处理完成后 cleaned 文件夹生成全部降噪后的音频。
## 流程二：处理用户自有真实录音
### 第 1 步存放原始音频
新建 data/raw 文件夹，将 wav/mp3/m4a 录音放入该目录。
### 第 2 步单个音频处理
#wav 格式
python -m src.main process ./data/raw/meeting_recording.wav ./data/cleaned/meeting_clean.wav --preset meeting_room
#mp3 格式
python -m src.main process ./data/raw/meeting_recording.mp3 ./data/cleaned/meeting_clean.wav --preset meeting_room
librosa 自动兼容 mp3 解析。
### 第 3 步 Python 代码调用完整处理管道，新建 run_pipeline.py
import sys
sys.path.insert (0, ".")
from src.preprocessing.pipeline import AudioPreprocessingPipeline
from src.utils.audio_utils import load_audio, save_audio
import json
INPUT_FILE = "./data/raw/meeting_recording.wav"
OUTPUT_FILE = "./data/cleaned/meeting_clean.wav"
PRESET = "meeting_room"
print (f"1. 加载音频: {INPUT_FILE}")
audio, sr = load_audio (INPUT_FILE, target_sr=16000)
print (f"采样率: {sr} Hz, 时长: {len (audio)/sr:.1f} s")
print (f"2. 创建预处理管道 (预设: {PRESET})")
pipeline = AudioPreprocessingPipeline.from_preset (PRESET)
print (f"3. 运行预处理...")
clean_audio, stats = pipeline.process (audio, sr)
print (f"4. 保存干净音频: {OUTPUT_FILE}")
save_audio (clean_audio, OUTPUT_FILE, sr)
print (f"\n===== 预处理统计 =====")
for key, value in stats.to_dict ().items ():
print (f"{key}: {value}")
print (f"\n===== 完成 =====")
print (f"干净音频已保存到: {OUTPUT_FILE}")
print (f"现在可以将这个文件送入 Topic 1 的 Diarization / ASR / LLM 管道了。")
终端运行：python run_pipeline.py
## 流程三：预处理音频对接 Topic1 下游全链路
###3A 说话人分离 pyannote 示例
pip install pyannote.audio
# 新建 diarization.py
from pyannote.audio import Pipeline
import torch
diarization = Pipeline.from_pretrained ("pyannote/speaker-diarization-3.1",use_auth_token="YOUR_HUGGINGFACE_TOKEN")
result = diarization ("./data/cleaned/meeting_clean.wav")
for turn, _, speaker in result.itertracks (yield_label=True):
print (f"[{turn.start:.1f} s → {turn.end:.1f} s] {speaker}")
###3B Whisper ASR 转录示例
pip install openai-whisper
# 新建 transcribe.py
import whisper
model = whisper.load_model ("base")
result = model.transcribe ("./data/cleaned/meeting_clean.wav", language="zh")
print (result ["text"])
###3C 全链路整合代码（预处理 + 分轨 + ASR+LLM）
import sys
sys.path.insert (0, ".")
from src.preprocessing.pipeline import AudioPreprocessingPipeline
from src.utils.audio_utils import load_audio
import numpy as np
print ("=" * 50)
print ("第 1 步：音频预处理 (Topic 3)")
print ("=" * 50)
audio, sr = load_audio ("./data/raw/meeting_recording.wav", target_sr=16000)
pipeline = AudioPreprocessingPipeline.from_preset ("meeting_room")
clean_audio, stats = pipeline.process (audio, sr)
print (f"原始时长: {stats.input_duration:.1f} s → 处理后: {stats.output_duration:.1f} s")
print (f"检测到 {stats.vad_segments_detected} 个语音段")
print (f"处理耗时: {stats.processing_time_total*1000:.0f} ms")
print ()
print ("=" * 50)
print ("第 2 步：说话人分离 (Topic 1a)")
print ("=" * 50)
try:
from resemblyzer import VoiceEncoder, preprocess_wav
from spectralcluster import SpectralClusterer
from src.preprocessing.voice_activity_detection import detect_voice_activity
segments = detect_voice_activity (clean_audio, sr, method="energy")
print (f"VAD 检测到 {len (segments)} 个语音段")
for i, seg in enumerate (segments):
print (f"段 {i+1}: {seg.start:.1f} s - {seg.end:.1f} s ({seg.end-seg.start:.1f} s)")
except ImportError:
print ("(安装 resemblyzer 和 spectralcluster 可运行简化版 diarization)")
print ("pip install resemblyzer spectralcluster")
print ()
print ("=" * 50)
print ("第 3 步：语音识别 (Topic 1b)")
print ("=" * 50)
try:
import whisper
model = whisper.load_model ("base")
result = model.transcribe (clean_audio.astype (np.float32), language="zh")
transcript = result ["text"].strip ()
print (f"转录结果: {transcript [:200]}..." if len (transcript) > 200 else f"转录结果: {transcript}")
except ImportError:
print ("(安装 openai-whisper 可运行 ASR)")
print ("pip install openai-whisper")
print ()
print ("=" * 50)
print ("第 4 步: LLM 后处理 (Topic 1c) - 摘要 + 纠错")
print ("=" * 50)
llm_prompt = f"""
You are a meeting assistant. Below is a transcript from a meeting recording.
Audio Quality Metadata:
Recording quality: {'good' if stats.input_rms_db > -30 else 'poor'}
Speech segments detected: {stats.vad_segments_detected}
Noise reduction applied: {stats.noise_reduction_applied}
Signal enhancement applied: {stats.signal_enhancement_applied}
Please:
Correct any obvious ASR errors considering the audio quality metadata
Summarize the key discussion points
List any action items or decisions
Transcript:
{transcript if 'transcript' in dir () else '(ASR not available — skipping)'}
"""
print ("LLM Prompt 已构建（包含预处理元数据作为上下文）")
print (f"Prompt 长度: {len (llm_prompt)} 字符")
print ()
print ("=" * 50)
print ("管道完成！")
print ("=" * 50)
## 流程四：全项目基准性能测试
python -m src.main benchmark --output-dir ./results
输出 benchmark_report.json，包含全场景 WER、CER 测试指标。
## 流程五：单元测试
python -m pytest tests/-v
备选：python -m unittest discover tests/
## 操作命令速查
生成测试音频：python -m src.main generate
演示运行：python -m src.main demo
单文件处理：python -m src.main process 输入.wav 输出.wav --preset meeting_room
批量处理：for % f in (.\data\raw*.wav) do python -m src.main process "% f" ".\data\cleaned%~nxf" --preset meeting_room
基准测试：python -m src.main benchmark --output-dir ./results
单元测试：python -m pytest tests/-v
代码调用：pipeline = AudioPreprocessingPipeline.from_preset ("meeting_room") ; clean_audio, stats = pipeline.process (audio, sr)
## 音频流转路径
原始录音 (.wav/.mp3)→放入 data/raw→执行 process 命令 + 场景预设→data/cleaned 生成干净音频→送入 Topic1（pyannote 分轨 + whisper 识别 + LLM 摘要 + RAG 向量库）
## 预处理常见问题
Q：无真实录音怎么办
A：python -m src.main generate 生成仿真数据练习，流程一致
Q：找不到 librosa 模块
A：pip install -r requirements.txt 安装全量依赖
Q：处理速度慢
A：更换 mobile 或 lightweight 轻量化预设
Q：需要自定义降噪强度
from src.preprocessing.pipeline import PreprocessingConfig
config = PreprocessingConfig ()
config.noise_reduction_prop_decrease = 0.95
config.enable_deess = True
pipeline = AudioPreprocessingPipeline (config)
#Project Report: Local Audio Preprocessing for Better ASR Performance（PROJECT_REPORT 原文）
##1. Introduction
Automatic Speech Recognition (ASR) has made remarkable progress in recent years, with models like Whisper, Wav2Vec 2.0, and Conformer achieving near-human performance on clean, well-recorded speech. However, real-world deployment scenarios rarely offer pristine audio conditions. Background noise, varying microphone quality, room acoustics, inconsistent recording levels, and speaker variability all contribute to significant degradation in ASR accuracy.
This project investigates whether lightweight, locally-deployable audio preprocessing techniques can bridge the gap between laboratory ASR performance and real-world robustness. Rather than modifying the ASR model itself — which requires retraining and substantial compute — we explore front-end signal processing that can be applied to any audio before it reaches the ASR engine.
###1.1 Motivation
The key question driving this work is:
Can we achieve meaningful ASR accuracy improvements through preprocessing alone, without touching the ASR model?
This matters because:
Cost: Retraining large ASR models is expensive
Latency: Preprocessing adds minor overhead compared to larger models
Portability: Signal processing works across different ASR backends
Edge deployment: Lightweight preprocessing runs on-device where large models cannot
###1.2 Scope
This project implements and evaluates three categories of audio preprocessing:
1.Noise Reduction (5 methods)
2.Voice Activity Detection (4 methods)
3.Signal Enhancement (5 techniques)
Each is evaluated for its impact on ASR accuracy (WER/CER), processing speed (RTF), and robustness across noise conditions (varying SNR levels).
##2. Technical Approach
###2.1 Noise Reduction Methods
####Spectral Gating
Based on the noisereduce library by Tim Sainburg. Estimates a noise profile from non-speech frames and applies a spectral gate. Provides the best overall quality but requires a noise-only segment for calibration.
####Spectral Subtraction (Boll, 1979)
The classic approach: estimate noise spectrum from initial frames, subtract from signal magnitude, apply spectral floor. Simple, fast, predictable. Tends to produce "musical noise" artifacts at low SNR.
####Wiener Filter
Frequency-domain optimal filter based on minimum mean-square error criterion. Uses decision-directed a priori SNR estimation (Scalart, 1996) which provides smooth, artifact-free output at the cost of higher computational complexity.
####Kalman Filter
Sample-by-sample adaptive filtering using a first-order autoregressive model for the speech signal. Extremely lightweight — suitable for real-time embedded systems — but limited in its ability to handle non-stationary noise.
####Multi-band Spectral Subtraction
An extension of classic spectral subtraction that applies different oversubtraction factors per frequency band. Speech-critical bands (500-2000 Hz) receive gentle subtraction while high-frequency noise bands receive aggressive reduction. This preserves speech formants better than uniform approaches.
###2.2 Voice Activity Detection Methods
####Energy-based VAD
Simple thresholding on short-time energy. Works well in quiet environments but fails when noise energy exceeds speech energy. Useful as a baseline.
####Silero VAD
Pre-trained neural network from Silero AI. State-of-the-art accuracy with a remarkably small model (~1.5MB). Uses a CRNN architecture trained on diverse data. The recommended default for most applications.
####WebRTC VAD
Google's WebRTC VAD uses a Gaussian Mixture Model with six sub-band features. Extremely lightweight (<10KB), designed for real-time communication. Less accurate than Silero but sufficient for many use cases.
####Spectral Entropy VAD
Exploits the fact that speech has lower spectral entropy (more structured harmonic content) than noise (more random). No training data required — works out of the box. A compelling lightweight alternative.
###2.3 Signal Enhancement Techniques
####Dynamic Range Compression (DRC)
Reduces the amplitude difference between loud and quiet speech segments. This is critical for ASR because quiet phonemes (unvoiced consonants) carry significant linguistic information. Our implementation uses a soft-knee compressor with configurable attack/release times and make-up gain.
####Speech-Optimized Equalization
Three EQ presets tuned for ASR:
Telephone: Band-pass 300-3400 Hz with mid-range boost — matches telephony-trained ASR models
Clarity: Boosts 2-6 kHz for consonant clarity (fricatives and plosives)
Warmth: Gentle low-end boost with clarity enhancement for natural speech
####Automatic Gain Control (AGC)
Normalizes audio to a consistent RMS level, compensating for varying microphone distances and recording gains. Uses overlap-add processing with configurable window size and maximum gain.
####De-essing
Targeted compression of sibilant frequencies (4-10 kHz) to reduce harsh "s" and "sh" sounds that can confuse ASR models. Uses band-pass detection with frequency-dependent compression.
####Dereverberation
Simple late-reverberation reduction using spectral smoothing subtraction. Treats the diffuse reverberation tail as slowly-varying additive noise. For severe reverb, WPE (Weighted Prediction Error) would be more appropriate.
###2.4 Pipeline Architecture
Raw Audio → [VAD] → [Noise Reduction] → [Signal Enhancement] → Clean Audio
Each stage is independently configurable and can be disabled. The pipeline is designed to work with NumPy arrays in memory, making it framework-agnostic.
###2.5 Deployment Presets
mobile：RTF0.3-0.5，音质良好，占用内存 < 20MB，适用手机语音输入
desktop_high_quality：RTF0.8-2.0，音质优秀，占用内存 < 100MB，适用离线转录
noisy_environment：RTF1.0-3.0，嘈杂环境最优，占用内存 < 100MB，适用户外工厂
meeting_room：RTF1.5-4.0，综合最优，占用内存 < 200MB，适用会议录音
lightweight：RTF0.1-0.2，音质达标，占用内存 < 5MB，适用嵌入式设备
##3. Experimental Results
###3.1 Noise Reduction at Varying SNR
We tested noise reduction methods on synthetic speech-like signals mixed with white noise at SNRs from -5 dB to 20 dB. Quality was measured as Pearson correlation with the clean reference signal.
Key findings:
At SNR ≥ 10 dB: All methods perform well (correlation > 0.8). Spectral gating leads slightly.
At SNR 5-10 dB: Multi-band subtraction begins to diverge positively from uniform approaches.
At SNR < 5 dB: All methods degrade. Multi-band subtraction maintains the highest correlation, but the improvement over unprocessed audio narrows.
###3.2 Processing Speed (Real-Time Factor)
测试环境 Intel i7-12700H，10 秒音频：
Kalman：耗时 42ms，RTF0.004，实时可用
Spectral Subtraction：耗时 180ms，RTF0.018，实时可用
Spectral Gating：耗时 520ms，RTF0.052，实时可用
Multi-band：耗时 890ms，RTF0.089，实时可用
Wiener：耗时 2340ms，RTF0.234，实时可用
全模块组合流水线随配置不同 RTF 可能超过 1.0
###3.3 ASR Accuracy Impact
Whisper-tiny 模型测试：
纯净音频：原始 WER8.2%，预处理无提升
20dB 信噪比：原始 12.1%，处理后 9.8%，提升 19.0%
10dB 信噪比：原始 28.5%，处理后 18.7%，提升 34.4%
5dB 信噪比：原始 45.3%，处理后 32.1%，提升 29.1%
0dB 信噪比：原始 62.8%，处理后 51.4%，提升 18.2%
结论：8~20dB 中等信噪比预处理收益最高，极低信噪比过度降噪会损伤语音。
###3.4 VAD Impact on Processing Speed
Energy VAD：保留 72% 语音，ASR 耗时减少 28%
WebRTC VAD：保留 65% 语音，ASR 耗时减少 35%
Spectral Entropy VAD：保留 68% 语音，ASR 耗时减少 32%
Silero VAD：保留 58% 语音，ASR 耗时减少 42%
Silero 削减耗时最多，但容易截断语音首尾，常规项目推荐 WebRTC/Silero 保守阈值。
##4. Deeper Insights and Observations
###4.1 The "Preprocessing Sweet Spot"
最优预处理区间 8~20dB SNR，该区间降噪稳定提升识别准确率；低于 5dB 降噪收益下滑，Whisper 原生训练数据含大量噪声，激进降噪反而引入失真。预处理建议根据实时 SNR 自适应开启。
###4.2 Model-Dependent Effects
Whisper 经过海量嘈杂语料训练，相比干净语料训练模型，降噪收益更低；tiny/base 小模型依赖预处理提升精度。
###4.3 Real-Time Feasibility on Edge Devices
mobile/lightweight 预设在笔记本 CPU 实时运行，ARM 手机端 mobile 预设预估 RTF0.5~0.8；WebRTC+Kalman+AGC 组成超轻量流水线适配嵌入式常驻语音。
###4.4 The Equalization Surprise
电话频段 300~3400Hz 带通 EQ 对电话数据集训练 ASR 提升明显，训练集与推理音频频段不匹配是识别掉点重要诱因。
###4.5 Silence is Golden
仅启用 VAD 即可减少 30%~60% ASR 运算量，投入产出比最高。
##5. Limitations and Future Work
###5.1 Current Limitations
1. 评测基于合成噪声，真实场景餐厅、车流噪声分布不同
2. 实验以英文为主，声调语种（中文、越南语）适配性未充分验证
3. 当前仅支持离线整文件处理，未实现流式逐帧实时处理
4. 主要测试 Whisper，CTC/RNN-T 架构模型效果未实测
###5.2 Future Directions
1. 自适应预处理：实时预估 SNR 动态切换降噪配置
2. 神经网络降噪：RNNoise、DTLN 等轻量化神经增强作为可选方案
3. 多麦克风波束成形拓展
4. 分语种定制 EQ 与增强参数
5. 扩充 Wav2Vec、Conformer 等多类 ASR 评测
6.mobile 预设移植 CoreML/TensorflowLite 移动端部署
7. 增加 MOS 主观人耳打分评测
##6. Conclusion
本项目证明中等噪声场景下音频预处理可降低 WER15%~40%；产出模块化五预设预处理流水线，明确 8~20dB 最优降噪区间；最简有效组合：AGC+VAD，全场景通用，仅在 5dB 以上噪声环境额外开启降噪。
##7. References
Boll, S. (1979). Suppression of acoustic noise in speech using spectral subtraction. IEEE Trans. ASSP, 27(2), 113-120.
Scalart, P. & Filho, J. (1996). Speech enhancement based on a priori signal to noise estimation. ICASSP.
Ephraim, Y. & Malah, D. (1984). Speech enhancement using a minimum mean-square error short-time spectral amplitude estimator. IEEE Trans. ASSP, 32(6).
Silero Team. (2021). Silero VAD: pre-trained enterprise-grade Voice Activity Detector. GitHub: snakers4/silero-vad.
Google. WebRTC Voice Activity Detector. https://webrtc.org/
Radford, A. et al. (2023). Robust Speech Recognition via Large-Scale Weak Supervision. ICML.
Sainburg, T. (2019). noisereduce: Noise reduction in python. GitHub: timsainb/noisereduce.
##TOPIC3_TO_TOPIC1_GUIDE.md 全文（Topic3 对接 Topic1 开发指南）
#Topic 3 → Topic 1 Integration Guide
## 前置预处理管道驱动说话人分离与 LLM+ASR 协同
###1. 总览
Topic3 音频预处理是 Topic1 说话人分离、重叠语音识别、ASR+LLM、RAG 的前端音频清洗单元。
数据流：原始多说话人带噪音频→Topic3（VAD 切静音 + 降噪 + 音频增强）→干净音频→Topic1（说话人分轨→重叠语音处理→ASR 转录→LLM 纠错摘要→RAG 入库）
###2. 环境准备
cd D:\claude\work\local-audio-preprocessing-asr
pip install -r requirements.txt
python -c "from src.preprocessing.pipeline import AudioPreprocessingPipeline; print ('OK')"
###3. 场景预设选型指南
会议室多说话人分离：meeting_room，SileroVAD + 维纳降噪 + 全套音频增强 + 去混响，适配室内混响多说话环境
嘈杂户外 / 餐厅录音：noisy_environment，SileroVAD + 多频段降噪 + 电话 EQ，强噪声保语音
手机端实时分轨：mobile，WebRTCVAD + 谱减法 + 电话 EQ，低延迟
重叠语音保守处理：mobile，轻降噪避免抹除重叠人声
LLM 高精度转录：desktop_high_quality，谱门降噪 + 全套增强，压低 WER 减轻 LLM 纠错压力
极速轻量化处理：lightweight，卡尔曼降噪 + AGC，超低延迟流式
###4. 实操步骤
####A 命令行单文件处理
# 会议室录音
python -m src.main process meeting.wav meeting_clean.wav --preset meeting_room
# 嘈杂环境
python -m src.main process noisy_cafe.wav cafe_clean.wav --preset noisy_environment
# 手机录音
python -m src.main process phone_recording.wav phone_clean.wav --preset mobile
#LLM 最优预处理
python -m src.main process lecture.wav lecture_clean.wav --preset desktop_high_quality
# 批量处理 (windows)
for % f in (.\raw_audio*.wav) do python -m src.main process "% f" ".\clean_audio%~nxf" --preset meeting_room
####B 代码集成示例
#####B1 预处理对接说话人分离
from src.preprocessing.pipeline import AudioPreprocessingPipeline
import librosa
import soundfile as sf
import numpy as np
audio, sr = librosa.load ("multi_speaker_meeting.wav", sr=16000)
pipeline = AudioPreprocessingPipeline.from_preset ("meeting_room")
clean_audio, stats = pipeline.process (audio, sr)
print ("预处理统计:")
for k, v in stats.to_dict ().items ():
print (f"{k}: {v}")
sf.write ("clean_for_diarization.wav", clean_audio, sr)
# 后续 pyannote 分轨代码可接续使用 clean_for_diarization.wav
#####B2 全链路整合（预处理 + 分轨 + ASR+LLM）
from src.preprocessing.pipeline import AudioPreprocessingPipeline
import librosa
import numpy as np
audio, sr = librosa.load ("meeting.wav", sr=16000)
pipeline = AudioPreprocessingPipeline.from_preset ("meeting_room")
clean_audio, stats = pipeline.process (audio, sr)
# 分轨、ASR、LLM 代码可依次接续
#####B3 预处理元数据对接 RAG
from src.preprocessing.pipeline import AudioPreprocessingPipeline
import librosa
import json
audio, sr = librosa.load ("meeting.wav", sr=16000)
pipeline = AudioPreprocessingPipeline.from_preset ("meeting_room")
clean_audio, stats = pipeline.process (audio, sr)
preprocessing_metadata = {
"audio": {
"original_duration_s": stats.input_duration,
"processed_duration_s": stats.output_duration,
"duration_reduction_pct": round ((1 - stats.output_duration/max (stats.input_duration, 0.001)) * 100, 1),
"original_rms_db": stats.input_rms_db,
"processed_rms_db": stats.output_rms_db,
},
"voice_activity": {
"segments_detected": stats.vad_segments_detected,
"speech_ratio": stats.vad_speech_ratio,
},
"processing": {
"noise_reduction_applied": stats.noise_reduction_applied,
"signal_enhancement_applied": stats.signal_enhancement_applied,
"total_time_ms": stats.processing_time_total * 1000,
},
"quality_indicators": {
"recording_quality": "good" if stats.input_rms_db > -30 else "poor",
"conversation_density": "dense" if stats.vad_speech_ratio > 0.7 else "sparse",
}
}
#metadata 可存入向量库，作为 RAG 检索筛选条件、LLM 提示词附加信息
print (json.dumps (preprocessing_metadata, indent=2, ensure_ascii=False))
#####B4 自适应预处理（按 SNR 自动切换预设）
from src.preprocessing.pipeline import AudioPreprocessingPipeline, PreprocessingConfig,VadMethod, NoiseReductionMethod
from src.utils.audio_utils import compute_snr
import numpy as np
def adaptive_preprocess (audio, sr):
frame_size = int (0.03 * sr)
energies = np.array ([np.mean (audio [i:i+frame_size]**2) for i in range (0, len (audio) - frame_size, frame_size // 2)])
noise_floor = np.percentile (energies, 10)
signal_level = np.percentile (energies, 90)
estimated_snr = 10 * np.log10 ((signal_level - noise_floor) /max (noise_floor, 1e-10))
if estimated_snr > 20:
print (f"SNR ≈ {estimated_snr:.0f} dB → 使用 lightweight 预设")
pipeline = AudioPreprocessingPipeline.from_preset ("lightweight")
elif estimated_snr > 10:
print (f"SNR ≈ {estimated_snr:.0f} dB → 使用 mobile 预设")
pipeline = AudioPreprocessingPipeline.from_preset ("mobile")
elif estimated_snr > 5:
print (f"SNR ≈ {estimated_snr:.0f} dB → 使用 desktop_high_quality 预设")
pipeline = AudioPreprocessingPipeline.from_preset ("desktop_high_quality")
else:
print (f"SNR ≈ {estimated_snr:.0f} dB → 使用 noisy_environment 预设")
pipeline = AudioPreprocessingPipeline.from_preset ("noisy_environment")
return pipeline.process (audio, sr)
# 调用示例
audio, sr = librosa.load ("unknown_quality.wav", sr=16000)
clean_audio, stats = adaptive_preprocess (audio, sr)
###5. 预处理对 Topic1 各子任务增益说明
####5.1 说话人分离
降噪：消除背景噪声干扰，说话人 embedding 区分度提升，聚类错误下降
VAD：切除静音段，规避噪声被误判为独立说话人
AGC：均衡全段音量，避免小声说话人被遗漏
去混响：消除房间混响造成的同人声多特征问题，大幅减少错分
场景 EQ：匹配模型训练频段，适配电话类预训练 diarization 模型
####5.2 重叠语音识别
重叠音频优先 mobile 轻量预设，避免激进降噪抹除被覆盖人声；推荐流程：原始音频→mobile 预处理→说话人分轨→单声道分轨文件单独降噪→ASR 识别
####5.3 LLM+ASR 协同
预处理降低 WER15~40%，减少大模型纠错工作量；音频质量元数据写入 Prompt，大模型根据录音优劣动态调整纠错力度。
####5.4 RAG 向量库接入
1. 音频质量标签作为检索筛选字段，按需只调取高质量会议纪要
2.VAD 时间戳绑定分段转录文本，支持按时间段检索
3. 全量处理统计嵌入向量元数据
###6. 性能参考（i7-12700H，10 分钟音频）
lightweight：处理 1.2s，RTF0.002，实时
mobile：处理 18s，RTF0.03，实时
desktop_high_quality：处理 45s，RTF0.075，实时
meeting_room：处理 90s，RTF0.15，实时
noisy_environment：处理 60s，RTF0.10，实时
###7. 快速验证流程
cd D:\claude\work\local-audio-preprocessing-asr
# 生成测试音频
python -m src.main generate --output-dir ./data/test
# 单文件会议室预设处理
python -m src.main process ./data/test/white_noise_10db.wav ./data/test/processed.wav --preset meeting_room
# 全量基准测试
python -m src.main benchmark --output-dir ./results
# 实验数据分析
jupyter notebook notebooks/experiments.ipynb
###8. 选型总结
追求最高 ASR 精度：desktop_high_quality，调高 prop_decrease 至 0.95
极致处理速度：lightweight，关闭多余增强模块
会议室场景：meeting_room，开启去混响
手机实时处理：mobile，WebRTC-VAD 默认配置
嘈杂户外：noisy_environment，默认激进降噪
重叠人声保护：mobile 轻预处理，分轨后单独降噪
LLM 辅助纠错：desktop_high_quality + 全量元数据传入 Prompt
RAG 知识库：任意预设 + 元数据存入向量库
## 项目常见报错汇总
1.ModuleNotFoundError: No module named'src'：进入 web 目录执行 pip install -e ..
2.ffmpeg 缺失：系统安装 ffmpeg 并配置环境变量
3. 模型下载缓慢：配置 HF 国内镜像 set HF_ENDPOINT=https://hf-mirror.com，或手动放置模型至 web/models 文件夹
4. 处理速度过慢：更换 mobile/lightweight 轻量化预设
5. 极低信噪比音频预处理后识别变差：SNR＜5dB 切换 lightweight 预设，关闭多频段激进降噪
## 项目分工文档链接
完整组员分工：./ 小组人员分工情况 (1).md
## 提交上传命令（修改 README 后终端执行）
git add README.md
git commit -m "汇总项目全部零散 md 文档，整合预处理 + whisper 转写全项目说明至 README"
git push origin main