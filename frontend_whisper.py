import streamlit as st
import requests
import json

# -------------------------- 页面配置 --------------------------
st.set_page_config(page_title="Whisper Transcription", layout="wide")
st.title("🎙️ Whisper 音视频转写工具")
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
    output_formats = st.multiselect("输出格式", ["SRT 字幕", "纯文本 TXT"], default=["SRT 字幕", "纯文本 TXT"])
    overwrite = st.checkbox("强制覆写已有文件", value=False)

    if st.button("加载模型"):
        with st.spinner("加载中..."):
            resp = requests.post(f"{API_URL}/model/load", params={"model_choice": model_opt})
            if resp.ok:
                st.success(resp.json()["message"])
            else:
                st.error("模型加载失败")

# -------------------------- 主界面：两种模式 --------------------------
tab1, tab2 = st.tabs(["📁 批量目录处理", "📤 单个文件上传"])

# 1. 批量目录处理
with tab1:
    st.subheader("批量处理目录下的所有音视频")
    dir_path = st.text_input("音视频目录路径", value="./audio-or-video-files-to-transcribe")
    if st.button("开始批量转写", type="primary"):
        with st.spinner("处理中..."):
            payload = {
                "directory": dir_path,
                "languages": languages,
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

# 2. 单个文件上传
with tab2:
    st.subheader("上传单个音视频文件")
    uploaded_file = st.file_uploader("选择文件", type=["mp4", "mkv", "mp3", "wav", "m4a"])
    lang_single = st.selectbox("识别语言", ["en", "zh", "ja", "ko", "fr", "de"], index=0)
    out_format = st.radio("输出格式", ["srt", "txt", "both"], index=2)

    if uploaded_file and st.button("开始转写", type="primary"):
        with st.spinner("转写中..."):
            files = {"file": (uploaded_file.name, uploaded_file.getvalue())}
            params = {"language": lang_single, "output_format": out_format}
            resp = requests.post(f"{API_URL}/transcribe/file", files=files, params=params)
            if resp.ok:
                data = resp.json()
                st.download_button("下载 SRT", data.get("srt", ""), file_name=f"{uploaded_file.name}.srt")
                st.download_button("下载 TXT", data.get("txt", ""), file_name=f"{uploaded_file.name}.txt")
                st.code(data.get("txt", ""))
            else:
                st.error(f"错误: {resp.text}")