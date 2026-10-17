#!/usr/bin/env python3
"""24PA Melo TTS 合成脚本（F19/spec 2.3，随 dsh-24pa 分发的参考实现）。

用法：python3 melo_synth.py --dir <meloDir> --out <out.wav>，正文从 stdin 读入。
meloDir 约定（部署见 docs/24PA-初始化指南.md「语音晨报」节）：
  - model.int8.onnx / lexicon.txt / tokens.txt / dict/ —— MeloTTS zh_en 模型全套；
  - 可选 `python` 符号链接指向装有 sherpa-onnx 的解释器（缺省用 PATH 上的 python3）。

坑位说明（生产实测，docs/research/F19-晨报复盘语音投递实现研究.md 6.2）：
构造必须走 OfflineTtsConfig(OfflineTtsModelConfig(vits=…))；samples 是
[-1,1] 浮点，必须 ×32767 夹取成 int16，直接 int() 会得到全零静音。
"""

import argparse
import sys
import wave
from array import array
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="24PA Melo TTS synthesizer")
    parser.add_argument("--dir", required=True, help="Melo model directory")
    parser.add_argument("--out", required=True, help="output wav path")
    args = parser.parse_args()

    base = Path(args.dir)
    model = base / "model.int8.onnx"
    if not model.exists():
        print(f"model not found: {model}", file=sys.stderr)
        return 2

    text = sys.stdin.read().strip()
    if not text:
        print("empty text on stdin", file=sys.stderr)
        return 2

    try:
        import sherpa_onnx
    except ImportError:
        print("sherpa-onnx is not installed for this interpreter", file=sys.stderr)
        return 3

    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(model),
                lexicon=str(base / "lexicon.txt"),
                tokens=str(base / "tokens.txt"),
                dict_dir=str(base / "dict"),
            )
        ),
        max_num_sentences=1,
    )
    tts = sherpa_onnx.OfflineTts(config)
    audio = tts.generate(text)
    samples = array("h", (max(-32768, min(32767, int(x * 32767))) for x in audio.samples))
    with wave.open(args.out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(audio.sample_rate)
        wav.writeframes(samples.tobytes())
    return 0


if __name__ == "__main__":
    sys.exit(main())
