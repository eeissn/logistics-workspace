import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fastapi import HTTPException

from backend.sheets import SheetWriter


class SheetWriterTests(unittest.TestCase):
    def test_append_duplicate_restart_and_ambiguous_failure(self):
        headers = {"Кто": "actor", "Номер": "number", "Имя": "title",
                   "Сумма": "amount", "Дата": "requested", "Срок": "promised"}
        row = {"number": "001", "title": "=1+1", "amount": "12.50",
               "requested": "2026-11-13", "promised": "2026-11-14"}
        posts = []
        fail = False

        def transport(request, timeout):
            if request.get_method() == "GET":
                return io.BytesIO(json.dumps({"values": [list(headers)]}).encode())
            posts.append(json.loads(request.data)["values"][0])
            self.assertIn("valueInputOption=RAW", request.full_url)
            if fail:
                raise TimeoutError
            return io.BytesIO(b'{"spreadsheetId":"test","updates":{"updatedRows":1}}')

        with TemporaryDirectory() as temp:
            path = Path(temp) / "test.sqlite3"

            def writer():
                return SheetWriter(path, "test", "Sandbox", headers, {"a": "Герман"}, lambda: "fake", transport)

            self.assertFalse(writer()("a", row)["duplicate"])
            self.assertTrue(writer()("a", {**row, "amount": "12.5"})["duplicate"])
            self.assertEqual(posts, [["Герман", "001", "=1+1", 12.5, "2026-11-13", "2026-11-14"]])
            fail = True
            next_row = {**row, "number": "002"}
            for code in (502, 425):
                with self.assertRaises(HTTPException) as raised:
                    writer()("a", next_row)
                self.assertEqual(raised.exception.status_code, code)
            self.assertEqual(len(posts), 2)
