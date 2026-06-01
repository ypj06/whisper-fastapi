import streamlit as st
import requests
import json
import base64
import numpy as np

# -------------------------- 页面配置 --------------------------
st.set_page_config(page_title="Whisper Transcription + Audio Preprocessing", layout="wide")
st.title("🎙️ Whisper 音视频转写 & 音频预处理")
st.caption("Topic 1 (ASR) + Topic 3 (Audio Preprocessing) 一体化工具")
st.divider()

API_URL = "http://localhost:8000"  # 和 FastAPI 地址保持一致

# -------------------------- 侧边栏配置 --------------------------
with st.sidebar:
    st.header("⚙️ 设置")
    model_opt = st.selectbox(
        "选择模型",
        options=[1,2,3,4,5,6,7],
        format_func=lambda x: f"{x} → {['tiny','base','small','medium','large-v1','large-v2','large-v3'][x-1]}"
    )
    languages = st.multiselect("识别语言", ["en", "zh", "ja", "ko", "fr", "de"], default=["en"])
    target_lang = st.selectbox(
        "字幕翻译目标语言（可选）",
        options=[None, "zh", "en", "ja", "ko", "fr", "de"],
        index=0,
        format_func=lambda x: "不翻译" if x is None else x,
        help="选择后自动翻译字幕；不选则保留原语言"
    )
    output_formats = st.multiselect("输出格式", ["SRT 字幕", "纯文本 TXT"], default=["SRT 字幕", "纯文本 TXT"])
    overwrite = st.checkbox("强制覆写已有文件", value=False)

    if st.button("加载模型"):
        with st.spinner("加载中..."):
            resp = requests.post(f"{API_URL}/model/load", params={"model_choice": model_opt})
            if resp.ok:
                st.success(resp.json()["message"])
            else:
                st.error("模型加载失败")

# -------------------------- 主界面：4个标签页 --------------------------
tab1, tab2, tab3, tab4 = st.tabs([
    "📁 批量目录转写",
    "📤 单个文件转写",
    "🧹 音频预处理（降噪）",
    "🔀 预处理 + 转写对比"
])

# =============================================================================
# Tab 1: 批量目录处理（原有功能）
# =============================================================================
with tab1:
    st.subheader("批量处理目录下的所有音视频")
    dir_path = st.text_input("音视频目录路径", value="./audio-or-video-files-to-transcribe")
    if st.button("开始批量转写", type="primary"):
        with st.spinner("处理中..."):
            payload = {
                "directory": dir_path,
                "languages": languages,
                "target_lang": target_lang,
                "model_choice": model_opt,
                "gen_srt": "SRT 字幕" in output_formats,
                "gen_txt": "纯文本 TXT" in output_formats,
                "overwrite": overwrite
            }
            resp = requests.post(f"{API_URL}/transcribe/batch", json=payload)
            if resp.ok:
                st.text("\n".join(resp.json()["log"]))
                st.success("批量处理完成！")
            else:
                st.error(f"错误: {resp.text}")

# =============================================================================
# Tab 2: 单个文件上传转写（原有功能）
# =============================================================================
with tab2:
    st.subheader("上传单个音视频文件")
    uploaded_file = st.file_uploader("选择文件", type=["mp4", "mkv", "mp3", "wav", "m4a"], key="transcribe_upload")
    lang_single = st.selectbox("识别语言（源语言）", ["en", "zh", "ja", "ko", "fr", "de"], index=0)
    target_lang_single = st.selectbox(
        "字幕翻译目标语言（可选）",
        options=[None, "zh", "en", "ja", "ko", "fr", "de"],
        index=0,
        format_func=lambda x: "不翻译" if x is None else x
    )
    out_format = st.radio("输出格式", ["srt", "txt", "both"], index=2)

    if uploaded_file and st.button("开始转写", type="primary"):
        with st.spinner("转写中..."):
            files = {"file": (uploaded_file.name, uploaded_file.getvalue())}
            params = {
                "language": lang_single,
                "target_lang": target_lang_single,
                "output_format": out_format
            }
            resp = requests.post(f"{API_URL}/transcribe/file", files=files, params=params)
            if resp.ok:
                data = resp.json()
                st.download_button("下载 SRT", data.get("srt", ""), file_name=f"{uploaded_file.name}.srt")
                st.download_button("下载 TXT", data.get("txt", ""), file_name=f"{uploaded_file.name}.txt")
                st.code(data.get("txt", ""))
            else:
                st.error(f"错误: {resp.text}")

# =============================================================================
# Tab 3: 音频预处理 — Topic 3 核心功能（新增）
# =============================================================================
with tab3:
    st.subheader("🧹 音频预处理（降噪 + 语音增强 + VAD）")
    st.markdown("""
    上传噪声录音 → 选择预处理预设 → 输出干净音频。
    处理后的音频可用于后续 **说话人分离、ASR 转录、或喂给 LLM**。
    """)

    # 获取可用的预设列表
    try:
        presets_resp = requests.get(f"{API_URL}/preprocess/presets", timeout=5)
        preset_info = presets_resp.json() if presets_resp.ok else {}
    except:
        preset_info = {}

    # 两列布局：左侧上传 + 预设选择，右侧实时效果
    col_left, col_right = st.columns([1, 1])

    with col_left:
        uploaded_noisy = st.file_uploader(
            "上传噪声录音（音频或视频文件）",
            type=["wav", "mp3", "m4a", "flac", "ogg", "mp4", "mkv", "webm", "flv", "avi", "mov"],
            key="preprocess_upload"
        )

        # 预设选择
        preset_options = list(preset_info.keys()) if preset_info else [
            "mobile", "desktop_high_quality", "noisy_environment",
            "meeting_room", "lightweight"
        ]
        preset_choice = st.selectbox(
            "预处理预设",
            options=preset_options,
            format_func=lambda x: {
                "mobile": "📱 Mobile — 手机端，低延迟",
                "desktop_high_quality": "🖥️ Desktop HQ — 桌面离线，最高质量",
                "noisy_environment": "🔊 Noisy — 工厂/户外，激进降噪",
                "meeting_room": "🏢 Meeting — 会议室，去混响",
                "lightweight": "⚡ Lightweight — 极速，嵌入式",
            }.get(x, x),
            key="preset_select"
        )

        # 显示当前预设的配置详情
        if preset_choice in preset_info:
            cfg = preset_info[preset_choice]
            with st.expander("📋 当前预设配置", expanded=False):
                st.json(cfg)

        # 高级选项
        with st.expander("🔧 高级调整", expanded=False):
            nr_strength = st.slider("降噪强度", 0.0, 1.0, 0.85, 0.05,
                                    help="0=不降噪, 1=最强降噪")
            enable_vad = st.checkbox("启用 VAD（语音活动检测）", value=True)
            enable_nr = st.checkbox("启用 降噪", value=True)
            enable_se = st.checkbox("启用 信号增强", value=True)

        # 处理按钮
        process_clicked = st.button("🚀 运行预处理", type="primary", use_container_width=True)

    with col_right:
        # 显示预设说明
        st.markdown("##### 预设速查")
        st.markdown("""
        | 场景 | 推荐预设 |
        |------|---------|
        | 会议室多人说话 | `meeting_room` |
        | 嘈杂环境单人说 | `noisy_environment` |
        | 手机/边缘设备 | `mobile` |
        | 最高质量离线 | `desktop_high_quality` |
        | 最小延迟 | `lightweight` |
        """)

        # 最近一次预处理的结果
        if st.session_state.get("preprocess_done"):
            st.success(f"✅ 处理完成！文件: {st.session_state.preprocess_filename}")
            st.metric("处理耗时", f"{st.session_state.preprocess_stats.get('processing_time_total_ms', 0):.0f} ms")
            st.metric("时长变化", f"{st.session_state.preprocess_stats.get('input_duration_s', 0):.1f}s → {st.session_state.preprocess_stats.get('output_duration_s', 0):.1f}s")

            # 如果有处理和原始音频，显示比较
            if "preprocess_raw_audio" in st.session_state and "preprocess_clean_audio" in st.session_state:
                st.markdown("##### 🔊 试听对比")
                tab_orig, tab_clean = st.tabs(["原始（噪声）", "处理后的（干净）"])
                with tab_orig:
                    st.audio(st.session_state.preprocess_raw_audio, format="audio/wav")
                with tab_clean:
                    st.audio(st.session_state.preprocess_clean_audio, format="audio/wav")

                # 下载按钮
                st.download_button(
                    "⬇️ 下载干净音频 (WAV)",
                    data=st.session_state.preprocess_clean_audio,
                    file_name=f"clean_{st.session_state.preprocess_filename}",
                    mime="audio/wav",
                    use_container_width=True,
                )

    # 处理逻辑（在 col_left 和 col_right 之外，占满宽度）
    if uploaded_noisy and process_clicked:
        with st.spinner("正在预处理音频..."):
            files = {"file": (uploaded_noisy.name, uploaded_noisy.getvalue())}
            params = {
                "preset": preset_choice,
                "nr_strength": nr_strength,
            }
            if not enable_vad:
                params["enable_vad"] = "false"
            if not enable_nr:
                params["enable_nr"] = "false"
            if not enable_se:
                params["enable_se"] = "false"

            resp = requests.post(f"{API_URL}/preprocess/audio", files=files, params=params)

            if resp.ok:
                data = resp.json()

                # 解码 base64 音频
                audio_bytes = base64.b64decode(data["processed_audio_base64"])

                # 存入 session_state
                st.session_state.preprocess_done = True
                st.session_state.preprocess_filename = data["filename"]
                st.session_state.preprocess_stats = data["stats"]
                st.session_state.preprocess_clean_audio = audio_bytes
                st.session_state.preprocess_raw_audio = uploaded_noisy.getvalue()

                st.success(f"✅ 预处理完成！耗时 {data['stats']['processing_time_total_ms']:.0f}ms")

                # 显示详细信息
                cols = st.columns(3)
                with cols[0]:
                    st.metric("原始时长", f"{data['original_duration_s']:.1f}s")
                with cols[1]:
                    st.metric("处理后时长", f"{data['processed_duration_s']:.1f}s")
                with cols[2]:
                    st.metric("VAD 片段数", data['stats']['vad_segments'])

                cols2 = st.columns(2)
                with cols2[0]:
                    st.metric("输入 RMS", f"{data['stats']['input_rms_db']:.1f} dB")
                with cols2[1]:
                    st.metric("输出 RMS", f"{data['stats']['output_rms_db']:.1f} dB")

                # 试听
                st.markdown("##### 🔊 试听对比")
                c1, c2 = st.columns(2)
                with c1:
                    st.markdown("**原始（噪声）**")
                    st.audio(uploaded_noisy.getvalue(), format="audio/wav")
                with c2:
                    st.markdown("**处理后的（干净）**")
                    st.audio(audio_bytes, format="audio/wav")

                # 下载按钮
                st.download_button(
                    "⬇️ 下载干净音频",
                    data=audio_bytes,
                    file_name=f"clean_{data['filename']}",
                    mime="audio/wav",
                    use_container_width=True,
                )

                # 展开显示完整 stats
                with st.expander("📊 完整处理统计", expanded=False):
                    st.json(data["stats"])
            else:
                st.error(f"预处理失败: {resp.text}")

# =============================================================================
# Tab 4: 预处理 + 转写对比 — Topic 1 + Topic 3 联合（新增）
# =============================================================================
with tab4:
    st.subheader("🔀 预处理 + 转写对比")
    st.markdown("""
    同时对比 **原始音频** vs **预处理后音频** 的 Whisper 转写结果。
    直接观察降噪对 ASR 准确率的影响。
    """)

    uploaded_compare = st.file_uploader(
        "上传音频文件",
        type=["mp4", "mkv", "mp3", "wav", "m4a"],
        key="compare_upload"
    )

    col_left2, col_right2 = st.columns([1, 1])

    with col_left2:
        compare_preset = st.selectbox(
            "预处理预设",
            options=preset_options if preset_options else [
                "mobile", "desktop_high_quality", "noisy_environment",
                "meeting_room", "lightweight"
            ],
            format_func=lambda x: {
                "mobile": "📱 Mobile",
                "desktop_high_quality": "🖥️ Desktop HQ",
                "noisy_environment": "🔊 Noisy",
                "meeting_room": "🏢 Meeting",
                "lightweight": "⚡ Lightweight",
            }.get(x, x),
            key="compare_preset"
        )
        compare_language = st.selectbox(
            "识别语言",
            ["en", "zh", "ja", "ko", "fr", "de"],
            index=0,
            key="compare_lang"
        )

    with col_right2:
        with st.expander("🔧 高级设置", expanded=False):
            c_nr = st.slider("降噪强度", 0.0, 1.0, 0.85, 0.05, key="c_nr")
            c_vad = st.checkbox("VAD", value=True, key="c_vad")
            c_nr_enable = st.checkbox("降噪", value=True, key="c_nr_enable")
            c_se = st.checkbox("信号增强", value=True, key="c_se")

    # 预处理 + 转写按钮
    if uploaded_compare and st.button("🔄 预处理 + 转写", type="primary", use_container_width=True):
        with st.spinner("正在预处理并转写..."):
            files = {"file": (uploaded_compare.name, uploaded_compare.getvalue())}
            params = {
                "preset": compare_preset,
                "language": compare_language,
                "output_format": "both",
                "nr_strength": c_nr,
            }
            if not c_vad:
                params["enable_vad"] = "false"
            if not c_nr_enable:
                params["enable_nr"] = "false"
            if not c_se:
                params["enable_se"] = "false"

            resp = requests.post(f"{API_URL}/preprocess-and-transcribe", files=files, params=params)

            if resp.ok:
                data = resp.json()

                st.success(f"✅ 完成！预设: {data['preset_used']}, 语言: {data['language']}")

                # 统计信息
                stats = data["stats"]
                c1, c2, c3 = st.columns(3)
                with c1:
                    st.metric("原始时长", f"{stats['input_duration_s']:.1f}s")
                with c2:
                    st.metric("处理后时长", f"{stats['output_duration_s']:.1f}s")
                with c3:
                    st.metric("处理耗时", f"{stats['processing_time_total_ms']:.0f}ms")

                # 并排显示转写对比
                st.markdown("---")
                st.markdown("### 📝 转写对比")

                baseline_col, enhanced_col = st.columns(2)
                with baseline_col:
                    st.markdown("#### 🔴 原始音频（未预处理）")
                    baseline_text = data["comparison"]["baseline_text"]
                    st.text_area("原始转写", value=baseline_text, height=200, disabled=True)

                    # 下载原始转写
                    st.download_button(
                        "⬇️ 下载原始 TXT",
                        data=baseline_text,
                        file_name=f"baseline_{uploaded_compare.name}.txt",
                        use_container_width=True,
                    )

                    # 原始 SRT
                    baseline_srt = data["baseline"].get("srt", "")
                    if baseline_srt:
                        with st.expander("原始 SRT", expanded=False):
                            st.text(baseline_srt)

                with enhanced_col:
                    st.markdown("#### 🟢 预处理后音频")
                    enhanced_text = data["comparison"]["enhanced_text"]
                    st.text_area("预处理后转写", value=enhanced_text, height=200, disabled=True)

                    # 下载预处理后转写
                    st.download_button(
                        "⬇️ 下载预处理后 TXT",
                        data=enhanced_text,
                        file_name=f"enhanced_{uploaded_compare.name}.txt",
                        use_container_width=True,
                    )

                    # 预处理后 SRT
                    enhanced_srt = data["enhanced"].get("srt", "")
                    if enhanced_srt:
                        with st.expander("预处理后 SRT", expanded=False):
                            st.text(enhanced_srt)

                # 粗略的 WER 变化估算
                baseline_words = len(baseline_text.split())
                enhanced_words = len(enhanced_text.split())
                if baseline_words > 0 and enhanced_words > 0:
                    diff_words = abs(baseline_words - enhanced_words)
                    # 简单指标：文本长度变化率
                    change_pct = (diff_words / baseline_words) * 100

                    st.markdown("---")
                    st.markdown("### 📊 粗略变化分析")
                    info_cols = st.columns(3)
                    with info_cols[0]:
                        st.metric("原始词数", baseline_words)
                    with info_cols[1]:
                        st.metric("预处理后词数", enhanced_words)
                    with info_cols[2]:
                        st.metric("文本差异率", f"{change_pct:.1f}%")

                # 所有 segments 详情
                st.markdown("---")
                with st.expander("📋 详细时间戳分段", expanded=False):
                    st.markdown("**原始时间轴**")
                    for seg in data["baseline"].get("segments", []):
                        st.markdown(f"`{seg['start']:.1f}s - {seg['end']:.1f}s` {seg['text']}")

                    st.markdown("**预处理后时间轴**")
                    for seg in data["enhanced"].get("segments", []):
                        st.markdown(f"`{seg['start']:.1f}s - {seg['end']:.1f}s` {seg['text']}")

            else:
                st.error(f"请求失败: {resp.text}")
