"""Real Pillow pixels and protocol tests, using only temporary destinations."""

import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

from PIL import Image
import resize_image as legacy
import process_image as worker


def png(image):
    return worker.save_bytes(image, "PNG")


def decoded(data):
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        return image.convert("RGBA")


def fixture(width=61, height=43):
    image = Image.new("RGBA", (width, height))
    image.putdata([
        ((x * 17) % 256, (y * 31) % 256, ((x + y) * 13) % 256, (0, 40, 127, 255)[(x + y) % 4])
        for y in range(height) for x in range(width)
    ])
    return image


class PythonImageTests(unittest.TestCase):
    def test_bundled_script_matches_recorded_hash_and_defaults_come_from_its_parser(self):
        manifest = json.loads((ROOT / "python" / "resize-source.json").read_text(encoding="utf-8"))
        copied = (ROOT / "python" / manifest["copy"]).read_bytes()
        self.assertEqual(hashlib.sha256(copied).hexdigest(), manifest["sha256"])
        info = worker.resize_source_info()
        defaults = legacy.build_parser().parse_args([])
        self.assertEqual(info["sourceSha256"], manifest["sha256"])
        self.assertEqual(info["defaults"]["height"], defaults.size)
        self.assertEqual(info["defaults"]["palette"], defaults.palette)
        self.assertNotIn("nearest", info["defaults"])
        self.assertEqual(info["defaults"]["resample"], "LANCZOS")

    def test_bundled_cli_and_original_pipeline_match_backend_pixels(self):
        original = fixture()
        data = png(original)
        with tempfile.TemporaryDirectory(prefix="resize-python-") as directory:
            source = Path(directory) / "原图.png"
            source.write_bytes(data)
            for nearest in (False, True):
                for square, palette in ((False, False), (False, True), (True, False), (True, True)):
                    with self.subTest(nearest=nearest, square=square, palette=palette):
                        # Old requests may still contain nearest=True. Both now use LANCZOS.
                        resample = Image.Resampling.LANCZOS
                        destination = Path(directory) / f"legacy-{nearest}-{square}.png"
                        legacy.resize_png(source, destination, 20, resample, Image, palette, square)
                        settings = {"mode": "exact", "width": 20, "height": 20, "fit": "stretch"} if square else {"mode": "height", "height": 20}
                        with patch.object(worker.original_resize, "resize_png", wraps=legacy.resize_png) as original_call:
                            metadata, encoded = worker.process_image(data, {**settings, "nearest": nearest, "palette": palette})
                            original_call.assert_called_once()
                            self.assertEqual(original_call.call_args.args[2:], (20, resample, Image, palette, square))
                        actual = decoded(encoded)
                        expected_size = (20 if square else round(61 * 20 / 43), 20)
                        reference = original.convert("RGBA").resize(expected_size, resample)
                        if palette:
                            reference = reference.convert("P", palette=Image.Palette.ADAPTIVE, colors=256).convert("RGBA")
                        self.assertEqual(actual.size, expected_size)
                        self.assertEqual(actual.tobytes(), reference.tobytes())
                        self.assertEqual(actual.tobytes(), decoded(destination.read_bytes()).tobytes())
                        self.assertEqual(encoded, destination.read_bytes())
                        self.assertEqual(metadata["original"], {"width": 61, "height": 43})
                        self.assertEqual(metadata["processing"], {"engine": "pillow", "resample": "LANCZOS", "palette": palette})
            self.assertEqual(source.read_bytes(), data)

    def test_removed_nearest_option_cannot_change_extension_pixels_or_plans(self):
        data = png(fixture())
        for settings in [
            {"mode": "height", "height": 20}, {"mode": "width", "width": 20},
            {"mode": "percent", "percent": 33}, {"mode": "fit", "width": 20, "height": 18},
            *({"mode": "exact", "width": 24, "height": 20, "fit": fit} for fit in ("stretch", "contain", "cover")),
        ]:
            with self.subTest(settings=settings):
                options = {**settings, "pngOptimize": False}
                _, expected = worker.process_image(data, options)
                metadata, actual = worker.process_image(data, {**options, "nearest": True})
                self.assertEqual(actual, expected)
                self.assertEqual(metadata["processing"]["resample"], "LANCZOS")
                plan = worker.plan_images({"images": [{"id": "source", "width": 61, "height": 43}], "options": {**options, "nearest": True}})
                self.assertEqual(plan["processing"]["resample"], "LANCZOS")

    def test_rounding_and_all_five_modes(self):
        self.assertEqual(worker.geometry(5, 10, {"mode": "height", "height": 5})["width"], 2)
        self.assertEqual(worker.geometry(7, 10, {"mode": "height", "height": 5})["width"], 4)
        data = png(fixture(80, 40))
        for options, expected in [
            ({"mode": "height", "height": 20}, (40, 20)),
            ({"mode": "width", "width": 40}, (40, 20)),
            ({"mode": "percent", "percent": 12.5}, (10, 5)),
            ({"mode": "exact", "width": 30, "height": 10, "fit": "stretch"}, (30, 10)),
            ({"mode": "fit", "width": 30, "height": 30}, (30, 15)),
            ({"mode": "fit", "width": 300, "height": 300}, (80, 40)),
        ]:
            with self.subTest(options=options):
                self.assertEqual(decoded(worker.process_image(data, options)[1]).size, expected)

    def test_backend_plan_uses_actual_geometry_and_continues_past_bad_images(self):
        data = png(fixture(80, 40))
        for options in [
            {"mode": "height", "height": 20}, {"mode": "width", "width": 30},
            {"mode": "percent", "percent": 33.3}, {"mode": "fit", "width": 30, "height": 30},
            {"mode": "exact", "width": 30, "height": 20, "fit": "stretch"},
            {"mode": "exact", "width": 30, "height": 30, "fit": "contain"},
            {"mode": "exact", "width": 30, "height": 30, "fit": "cover"},
        ]:
            with self.subTest(options=options):
                plan = worker.plan_images({"images": [{"id": "sprite", "width": 80, "height": 40}], "options": options})
                metadata, _ = worker.process_image(data, options)
                self.assertEqual(plan["items"], [{"id": "sprite", "layout": metadata["layout"]}])
                self.assertEqual(plan["processing"], metadata["processing"])
        plan = worker.plan_images({"images": [
            {"id": "bad", "width": 0, "height": 4},
            {"id": "fraction", "width": 1.2, "height": 4},
            {"id": "infinite", "width": float("inf"), "height": 4},
            {"id": "huge", "width": 100001, "height": 1000},
            {"id": "small", "width": 2, "height": 1},
            {"id": "good", "width": 80, "height": 40},
        ], "options": {"mode": "height", "height": 20}})
        self.assertTrue(all("error" in item for item in plan["items"][:-1]))
        self.assertEqual(plan["items"][-1], {"id": "good", "layout": {"width": 40, "height": 20}})

    def test_original_function_failure_falls_back_and_palette_can_be_disabled(self):
        data = png(fixture())
        settings = {"mode": "height", "height": 20}
        baseline_metadata, baseline = worker.process_image(data, {**settings, "pngOptimize": False})
        with patch.object(worker.original_resize, "resize_png", side_effect=RuntimeError("save failed")):
            metadata, output = worker.process_image(data, settings)
            self.assertEqual(output, baseline)
            self.assertEqual(metadata["optimization"]["status"], "failed")
            self.assertEqual(metadata["optimization"]["savedBytes"], 0)
        with patch.object(worker.original_resize, "resize_png") as original_call:
            _, output = worker.process_image(data, {**settings, "pngOptimize": False, "palette": True})
            original_call.assert_not_called()
            with Image.open(io.BytesIO(output)) as image:
                self.assertEqual(image.mode, "P")

    def test_palette_extensions_validate_rgba_instead_of_palette_indices(self):
        data = png(fixture(120, 80))
        for fit in ("contain", "cover", "stretch"):
            with self.subTest(fit=fit):
                settings = {"mode": "exact", "width": 40, "height": 50, "fit": fit, "palette": True}
                _, baseline = worker.process_image(data, {**settings, "pngOptimize": False})
                with patch.object(worker.original_resize, "resize_png") as original_call:
                    metadata, output = worker.process_image(data, settings)
                    original_call.assert_not_called()
                self.assertIn(metadata["optimization"]["status"], ("optimized", "unchanged"))
                self.assertEqual(decoded(output).tobytes(), decoded(baseline).tobytes())
                with Image.open(io.BytesIO(output)) as image:
                    self.assertEqual(image.mode, "P")

    def test_png_optimization_preserves_all_rgba_including_invisible_rgb(self):
        original = fixture(160, 80)
        data = png(original)
        options = {"mode": "percent", "percent": 100}
        baseline_metadata, baseline = worker.process_image(data, {**options, "pngOptimize": False})
        metadata, optimized = worker.process_image(data, options)
        self.assertNotIn("optimization", baseline_metadata)
        self.assertEqual(decoded(baseline).tobytes(), original.tobytes())
        self.assertEqual(decoded(optimized).tobytes(), original.tobytes())
        self.assertEqual(metadata["optimization"]["originalBytes"], len(baseline))
        self.assertEqual(metadata["optimization"]["optimizedBytes"], len(optimized))
        self.assertEqual(metadata["optimization"]["savedBytes"], len(baseline) - len(optimized))
        self.assertLessEqual(len(optimized), len(baseline))
        if metadata["optimization"]["status"] == "optimized":
            self.assertLess(len(optimized), len(baseline))

    def test_optimizer_failure_pixel_mismatch_and_timeout_keep_baseline(self):
        image = fixture()
        baseline = png(image)
        with patch.object(worker, "save_bytes", side_effect=RuntimeError("codec failed")):
            result, stats = worker.optimize_png(image, baseline, Image)
            self.assertEqual((result, stats["status"], stats["savedBytes"]), (baseline, "failed", 0))
        changed = png(Image.new("RGBA", image.size, (10, 20, 30, 0)))
        self.assertLess(len(changed), len(baseline))
        with patch.object(worker, "save_bytes", return_value=changed):
            result, stats = worker.optimize_png(image, baseline, Image)
            self.assertEqual((result, stats["status"]), (baseline, "failed"))
        release = threading.Event()
        finished = threading.Event()
        def stalled(*args, **kwargs):
            release.wait(2)
            finished.set()
            return baseline
        with patch.object(worker, "save_bytes", side_effect=stalled):
            try:
                result, stats = worker.optimize_png(image, baseline, Image, timeout_seconds=0.001)
                self.assertEqual((result, stats["status"]), (baseline, "timed-out"))
            finally:
                release.set()
                self.assertTrue(finished.wait(2))

    def test_centered_pad_preserves_partial_alpha_and_crop_keeps_center(self):
        image = Image.new("RGBA", (8, 4), (30, 60, 90, 127))
        for y in range(4):
            for x in range(8):
                image.putpixel((x, y), (x * 30, y * 40, 90, 127))
        options = {"mode": "exact", "width": 4, "height": 4, "pngOptimize": False}
        padded = decoded(worker.process_image(png(image), {**options, "fit": "contain"})[1])
        self.assertEqual(padded.getpixel((0, 0)), (0, 0, 0, 0))
        self.assertEqual(padded.getpixel((0, 3)), (0, 0, 0, 0))
        self.assertEqual(padded.crop((0, 1, 4, 3)).tobytes(), image.resize((4, 2), Image.Resampling.LANCZOS).tobytes())
        cropped = decoded(worker.process_image(png(image), {**options, "fit": "cover"})[1])
        self.assertEqual(cropped.tobytes(), image.crop((2, 0, 6, 4)).tobytes())

    def test_jpeg_white_background_and_webp_transparency(self):
        image = Image.new("RGBA", (16, 16), (200, 30, 10, 0))
        for format_name in ("jpeg", "webp"):
            metadata, encoded = worker.process_image(png(image), {"mode": "percent", "percent": 100, "format": format_name, "quality": 0.95})
            with Image.open(io.BytesIO(encoded)) as output:
                self.assertEqual(output.size, image.size)
                self.assertEqual(output.format.lower(), format_name)
                if format_name == "jpeg":
                    self.assertEqual(output.getpixel((8, 8)), (255, 255, 255))
                else:
                    self.assertEqual(output.getpixel((8, 8))[3], 0)
            self.assertNotIn("optimization", metadata)

    def test_invalid_options_sizes_formats_and_decode_limits(self):
        data = png(fixture())
        for bad in [
            {"mode": "height", "height": 0}, {"mode": "height", "height": -1},
            {"mode": "height", "height": 1.5}, {"mode": "height", "height": float("inf")},
            {"mode": "percent", "percent": float("nan")}, {"mode": "percent", "percent": 1e308},
            {"mode": "height", "height": 100},
            {"mode": "exact", "width": 16384, "height": 16384, "allowUpscale": True},
            {"mode": "height", "height": 16385, "allowUpscale": True},
            {"mode": "wrong", "height": 10},
            {"mode": "exact", "width": 10, "height": 10, "fit": "wrong"},
            {"mode": "height", "height": 10, "format": "gif"},
            {"mode": "height", "height": 10, "format": []},
            {"mode": "height", "height": 10, "format": "jpeg", "quality": 2},
            {"mode": "height", "height": 10, "palette": "true"},
        ]:
            with self.subTest(options=bad), self.assertRaises(worker.ImageRequestError):
                worker.process_image(data, bad)
        with self.assertRaisesRegex(worker.ImageRequestError, "Cannot decode"):
            worker.process_image(b"not an image", {"mode": "height", "height": 10})
        with patch.object(worker, "MAX_INPUT_BYTES", len(data) - 1), self.assertRaisesRegex(worker.ImageRequestError, "80 MB"):
            worker.process_image(data, {"mode": "height", "height": 10})
        with patch.object(worker, "MAX_INPUT_PIXELS", 100), self.assertRaisesRegex(worker.ImageRequestError, "100 million"):
            worker.process_image(data, {"mode": "height", "height": 10})

    def test_worker_protocol_runtime_check_and_stable_errors(self):
        command = [sys.executable, "-B", str(ROOT / "python" / "process_image.py")]
        runtime = subprocess.run(command + ["--check"], capture_output=True, check=True)
        runtime_info = json.loads(runtime.stdout)
        self.assertIn("pillow", runtime_info)
        self.assertEqual(runtime_info["sourceSha256"], worker.resize_source_info()["sourceSha256"])
        options = {"mode": "height", "height": 20, "pngOptimize": True}
        original = png(fixture())
        result = subprocess.run(command, input=json.dumps(options).encode() + b"\n" + original, capture_output=True, check=True)
        metadata, encoded = result.stdout.split(b"\n", 1)
        self.assertEqual(json.loads(metadata)["layout"], {"width": 28, "height": 20})
        self.assertEqual(decoded(encoded).size, (28, 20))
        self.assertEqual(result.stderr, b"")
        plan = subprocess.run(command + ["--plan"], input=json.dumps({"images": [{"id": "image", "width": 61, "height": 43}], "options": options}).encode(), capture_output=True, check=True)
        self.assertEqual(json.loads(plan.stdout)["items"], [{"id": "image", "layout": {"width": 28, "height": 20}}])
        for bad in (b"{}", b"[]\n", b'{"mode":"percent","percent":NaN}\n', b'{"mode":"height","height":0}\n'):
            failed = subprocess.run(command, input=bad + original, capture_output=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertEqual(failed.stdout, b"")
            self.assertNotIn(b"Traceback", failed.stderr)
            self.assertTrue(failed.stderr.strip())


if __name__ == "__main__":
    unittest.main()
