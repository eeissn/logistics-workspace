"""Synthetic grid model: no Google tokens, network, production rows or writes."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

from fastapi import HTTPException

from backend.payments_sheet import (PAYMENTS_HEADERS, PaymentsSheetWriter,
                                    build_payments_batch, payment_formulas, payment_values)


SHEET_ID = 60261119
TAB = "Workspace API 20261119"
ROW = {"number": "SYNTHETIC-001", "title": "=1+1", "amount": "35000.50",
       "requested": "2026-11-19", "promised": "2026-11-20"}


class FakePaymentsAPI:
    def __init__(self, populated=True):
        self.rows = [{"values": [{} for _ in range(21)]} for _ in range(24)]
        for index, header in enumerate(PAYMENTS_HEADERS):
            self.rows[0]["values"][index] = {"userEnteredValue": {"stringValue": header}}
        self.rows[0]["values"][18] = {"userEnteredValue": {"stringValue": "service-marker"}}
        for index in range(1, 20):
            for column, formula in payment_formulas(index + 1).items():
                self.rows[index]["values"][column] = {"userEnteredValue": {"formulaValue": formula}}
        self.rows[1]["values"][4]["dataValidation"] = {"condition": {
            "type": "ONE_OF_LIST", "values": [{"userEnteredValue": "Герман"},
                                                {"userEnteredValue": "Марина"}]}}
        for column in (5, 6, 7):
            self.rows[1]["values"][column] = {"dataValidation": {"condition": {"type": "BOOLEAN"}},
                                             "userEnteredFormat": {"backgroundColor": {"red": 0.5}}}
        if populated:
            for column, value in payment_values({**ROW, "number": "OLD", "title": "Old row",
                                                "actor": "Герман"}, 2).items():
                self.rows[1]["values"][column]["userEnteredValue"] = value
            self.rows[1]["values"][5]["userEnteredValue"] = {"boolValue": True}
        self.calls, self.batches = [], []
        self.title, self.sheet_id = TAB, SHEET_ID
        self.row_count = 24
        self.protected = []
        self.merges = []
        self.timeout_after_write = False
        self.preflight_failure = False
        self.invalid_batch = False
        self.corrupt_readback = False
        self.started, self.continue_preflight = None, None

    def response(self, sheet):
        return io.BytesIO(json.dumps({"spreadsheetId": "synthetic-test", "sheets": [sheet]}).encode())

    def transport(self, request, timeout):
        self.calls.append((request.get_method(), request.full_url))
        self.assert_request(request, timeout)
        props = {"sheetId": self.sheet_id, "title": self.title}
        if request.get_method() == "GET":
            query = parse_qs(urlsplit(request.full_url).query)
            if "ranges" not in query:
                if self.preflight_failure:
                    raise TimeoutError("synthetic GET failure")
                if self.started:
                    self.started.set()
                    if not self.continue_preflight.wait(5):
                        raise RuntimeError("Synthetic synchronization timeout")
                return self.response({"properties": {**props, "gridProperties": {
                    "rowCount": self.row_count, "columnCount": 21}},
                    "protectedRanges": self.protected, "merges": self.merges})
            area = query["ranges"][0].split("!", 1)[1]
            start, end = area.split(":")
            first = int(start[1:]) - 1
            last = int(end[1:])
            rows = deepcopy(self.rows[first:last])
            if self.corrupt_readback and self.batches and first > 0:
                rows[0]["values"][1]["userEnteredValue"] = {"stringValue": "external edit"}
            return self.response({"properties": props, "data": [{
                "startRow": first, "startColumn": 0, "rowData": rows}]})
        batch = json.loads(request.data)
        self.batches.append(batch)
        if self.invalid_batch:
            raise ValueError("Atomic batch rejected before applying any request")
        rows = deepcopy(self.rows)
        for operation in batch["requests"]:
            if "insertDimension" in operation:
                index = operation["insertDimension"]["range"]["startIndex"]
                rows.insert(index, {"values": [{} for _ in range(21)]})
                # Google adjusts relative formulas when whole rows are inserted.
                for position in range(index + 1, len(rows)):
                    for column, formula in payment_formulas(position + 1).items():
                        if "formulaValue" in rows[position]["values"][column].get("userEnteredValue", {}):
                            rows[position]["values"][column]["userEnteredValue"] = {"formulaValue": formula}
            elif "copyPaste" in operation:
                copy = operation["copyPaste"]
                source = rows[copy["source"]["startRowIndex"]]["values"]
                destination = rows[copy["destination"]["startRowIndex"]]["values"]
                field = {"PASTE_FORMAT": "userEnteredFormat", "PASTE_DATA_VALIDATION": "dataValidation"}[copy["pasteType"]]
                for column in range(13):
                    if field in source[column]:
                        destination[column][field] = deepcopy(source[column][field])
            else:
                update = operation["updateCells"]
                rows[update["start"]["rowIndex"]]["values"][update["start"]["columnIndex"]].update(
                    deepcopy(update["rows"][0]["values"][0]))
        self.rows = rows
        self.row_count += 1
        if self.timeout_after_write:
            raise TimeoutError("Response lost after atomic application")
        return io.BytesIO(json.dumps({"spreadsheetId": "synthetic-test",
                                      "replies": [{} for _ in batch["requests"]]}).encode())

    @staticmethod
    def assert_request(request, timeout):
        if not request.full_url.startswith("https://sheets.googleapis.com/v4/spreadsheets/synthetic-test"):
            raise AssertionError("Unexpected destination")
        if request.headers.get("Authorization") != "Bearer synthetic-token" or timeout != 15:
            raise AssertionError("Unexpected credentials or timeout")


class PaymentsSheetTests(unittest.TestCase):
    def setUp(self):
        folder = self.enterContext(TemporaryDirectory())
        self.path = Path(folder) / "test.sqlite3"
        self.api = FakePaymentsAPI()

    def writer(self):
        return PaymentsSheetWriter(self.path, "synthetic-test", TAB, SHEET_ID,
                                   {"a": "Герман", "b": "Марина"}, lambda: "synthetic-token",
                                   coordinated_writes=True,
                                   transport=self.api.transport)

    def error(self, status, email="a", row=ROW):
        with self.assertRaises(HTTPException) as raised:
            self.writer()(email, row)
        self.assertEqual(raised.exception.status_code, status)

    def test_atomic_insert_uses_last_number_not_formula_tail_and_preserves_service(self):
        old = deepcopy(self.api.rows)
        self.assertEqual(self.writer()("a", ROW), {"actor": "Герман", "duplicate": False})
        batch = self.api.batches[0]
        self.assertEqual(batch["requests"][0]["insertDimension"]["range"]["startIndex"], 2)
        self.assertEqual([item["copyPaste"]["pasteType"] for item in batch["requests"][1:3]],
                         ["PASTE_FORMAT", "PASTE_DATA_VALIDATION"])
        self.assertEqual(self.api.rows[:2], old[:2])
        inserted = self.api.rows[2]["values"]
        for column, value in payment_values({**ROW, "actor": "Герман"}, 3).items():
            self.assertEqual(inserted[column]["userEnteredValue"], value)
        self.assertEqual(inserted[1]["userEnteredValue"], {"stringValue": "=1+1"})
        for column in (4, 5, 6, 7):
            self.assertEqual(inserted[column]["dataValidation"], old[1]["values"][column]["dataValidation"])
        for column in (5, 6, 7):
            self.assertNotIn("userEnteredValue", inserted[column])
        self.assertEqual(inserted[5]["userEnteredFormat"], old[1]["values"][5]["userEnteredFormat"])
        self.assertEqual(inserted[8]["userEnteredFormat"]["numberFormat"]["type"], "DATE")
        self.assertEqual(self.api.rows[20]["values"][9]["userEnteredValue"], {"formulaValue": payment_formulas(21)[9]})
        self.assertEqual(self.api.rows[0]["values"][18], old[0]["values"][18])
        for index in range(2, len(old)):
            expected = deepcopy(old[index])
            for column, formula in payment_formulas(index + 2).items():
                if "formulaValue" in expected["values"][column].get("userEnteredValue", {}):
                    expected["values"][column]["userEnteredValue"] = {"formulaValue": formula}
            self.assertEqual(self.api.rows[index + 1], expected)
        self.assertEqual(len(batch["requests"]), 11)
        self.assertFalse(any("append" in item for item in batch["requests"]))

    def test_empty_ledger_copies_shifted_row_two_template(self):
        self.api = FakePaymentsAPI(populated=False)
        self.writer()("a", ROW)
        requests = self.api.batches[0]["requests"]
        self.assertEqual(requests[0]["insertDimension"]["range"]["startIndex"], 1)
        self.assertFalse(requests[0]["insertDimension"]["inheritFromBefore"])
        self.assertEqual(requests[1]["copyPaste"]["source"]["startRowIndex"], 2)
        self.assertEqual(self.api.rows[1]["values"][0]["userEnteredValue"], {"stringValue": ROW["number"]})
        self.assertIn("dataValidation", self.api.rows[1]["values"][5])

    def test_receipt_survives_restart_and_accounts_use_server_actor(self):
        self.writer()("a", {**ROW, "actor": "browser-forgery"})
        self.assertTrue(self.writer()("a", ROW)["duplicate"])
        self.assertEqual(len(self.api.batches), 1)
        self.writer()("b", ROW)
        self.assertEqual(len(self.api.batches), 2)
        self.assertEqual(self.api.rows[3]["values"][4]["userEnteredValue"], {"stringValue": "Марина"})
        self.error(403, "not-authorized")

    def test_exact_preexisting_row_is_not_inserted_again(self):
        self.api.rows[1]["values"] = [dict(cell) for cell in self.api.rows[1]["values"]]
        for column, value in payment_values({**ROW, "actor": "Герман"}, 2).items():
            self.api.rows[1]["values"][column]["userEnteredValue"] = value
        self.assertTrue(self.writer()("a", ROW)["duplicate"])
        self.assertEqual(self.api.batches, [])
        self.assertTrue(self.writer()("a", ROW)["duplicate"])

    def test_bad_layout_formula_bounds_merge_protection_never_write(self):
        mutations = [
            lambda api: setattr(api, "title", "Wrong tab"),
            lambda api: setattr(api, "sheet_id", SHEET_ID + 1),
            lambda api: setattr(api, "row_count", 10001),
            lambda api: setattr(api, "merges", [{"sheetId": SHEET_ID}]),
            lambda api: setattr(api, "protected", [{"protectedRangeId": 1}]),
            lambda api: api.rows[0]["values"][1].update(userEnteredValue={"stringValue": "Wrong header"}),
            lambda api: api.rows[1]["values"][9].update(userEnteredValue={"formulaValue": "=1+1"}),
            lambda api: api.rows[5]["values"][10].update(userEnteredValue={"numberValue": 1}),
            lambda api: api.rows[5]["values"][1].update(userEnteredValue={"stringValue": "orphan"}),
            lambda api: api.rows[5]["values"][20].update(userEnteredValue={"stringValue": "side table"}),
            lambda api: api.rows[5]["values"][18].update(note="ancillary note"),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                self.api = FakePaymentsAPI()
                mutate(self.api)
                self.error(503)
                self.assertFalse(self.api.batches)
        self.api = FakePaymentsAPI()
        self.assertFalse(self.writer()("a", ROW)["duplicate"])

    def test_preflight_network_failure_releases_destination_without_receipt(self):
        self.api.preflight_failure = True
        self.error(503)
        self.api.preflight_failure = False
        self.assertFalse(self.writer()("a", ROW)["duplicate"])

    def test_early_ancillary_values_and_notes_are_unchanged_not_copied(self):
        self.api.rows[9]["values"][0]["userEnteredValue"] = {"stringValue": "OLD-010"}
        self.api.rows[1]["values"][13]["userEnteredValue"] = {"stringValue": "early side value"}
        self.api.rows[4]["values"][20]["note"] = "early side note"
        self.api.rows[9]["values"][13]["note"] = "note beside last order"
        before = deepcopy(self.api.rows)
        self.assertFalse(self.writer()("a", ROW)["duplicate"])
        self.assertEqual(self.api.rows[:10], before[:10])
        self.assertEqual(self.api.batches[0]["requests"][0]["insertDimension"]["range"]["startIndex"], 10)
        self.assertTrue(all(not cell for cell in self.api.rows[10]["values"][13:]))
        grid_get = next(url for method, url in self.api.calls if "ranges=" in url)
        self.assertIn("userEnteredValue,note", parse_qs(urlsplit(grid_get).query)["fields"][0])
        self.assertEqual(parse_qs(urlsplit(grid_get).query)["ranges"], ["'Workspace API 20261119'!A1:U24"])

    def test_ancillary_tail_at_or_below_insertion_blocks_without_writes(self):
        for row_index, column, content in ((10, 13, {"userEnteredValue": {"stringValue": "tail"}}),
                                            (14, 20, {"note": "tail note"})):
            with self.subTest(row=row_index, column=column):
                self.api = FakePaymentsAPI()
                self.api.rows[9]["values"][0]["userEnteredValue"] = {"stringValue": "OLD-010"}
                self.api.rows[row_index]["values"][column].update(content)
                before = deepcopy(self.api.rows)
                self.error(503)
                self.assertFalse(self.api.batches)
                self.assertEqual(self.api.rows, before)

    def test_verified_dropdown_placeholder_false_checkboxes_and_empty_strings_are_template(self):
        for row in self.api.rows[2:]:
            for column in range(13):
                if column not in (9, 10):
                    row["values"][column]["userEnteredValue"] = {"stringValue": ""}
            row["values"][4]["userEnteredValue"] = {"stringValue": "НЕОБХОДИМО УКАЗАТЬ"}
            for column in (5, 6, 7):
                row["values"][column]["userEnteredValue"] = {"boolValue": False}
        self.assertFalse(self.writer()("a", ROW)["duplicate"])
        self.assertEqual(self.api.batches[0]["requests"][0]["insertDimension"]["range"]["startIndex"], 2)
        self.assertEqual(self.api.rows[3]["values"][4]["userEnteredValue"],
                         {"stringValue": "НЕОБХОДИМО УКАЗАТЬ"})

    def test_named_actor_partial_data_or_checked_payment_in_tail_blocks(self):
        for column, value in ((4, {"stringValue": "Марина"}),
                               (1, {"stringValue": "partial company"}),
                               (5, {"boolValue": True})):
            with self.subTest(column=column):
                self.api = FakePaymentsAPI()
                self.api.rows[2]["values"][column]["userEnteredValue"] = value
                self.error(503)
                self.assertFalse(self.api.batches)

    def test_earlier_partial_row_is_preserved_above_last_identifier(self):
        self.api.rows[9]["values"][0]["userEnteredValue"] = {"stringValue": "OLD-010"}
        self.api.rows[5]["values"][1]["userEnteredValue"] = {"stringValue": "earlier partial row"}
        self.api.rows[5]["values"][2]["userEnteredValue"] = {"numberValue": 123}
        self.api.rows[5]["values"][4]["userEnteredValue"] = {"stringValue": "Марина"}
        before = deepcopy(self.api.rows[:10])
        self.assertFalse(self.writer()("a", ROW)["duplicate"])
        self.assertEqual(self.api.rows[:10], before)
        self.assertEqual(self.api.batches[0]["requests"][0]["insertDimension"]["range"]["startIndex"], 10)

    def test_oversized_remote_response_is_bounded_before_json_decode(self):
        writer = self.writer()
        reads = []

        class OversizedResponse(io.BytesIO):
            def read(self, size=-1):
                reads.append(size)
                return b"x" * size

        writer.transport = lambda request, timeout: OversizedResponse()
        with patch("backend.sheets.MAX_RESPONSE_BYTES", 1024):
            with self.assertRaises(HTTPException) as raised:
                writer("a", ROW)
            self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(reads, [1025])
        self.assertFalse(self.api.batches)
        self.assertFalse(self.writer()("a", ROW)["duplicate"])

    def test_unknown_outcome_blocks_same_and_other_requests_across_restart(self):
        self.api.timeout_after_write = True
        self.error(502)
        self.api.timeout_after_write = False
        self.error(425)
        self.error(425, "b", {**ROW, "number": "OTHER"})
        self.assertEqual(len(self.api.batches), 1)
        self.assertEqual(self.api.rows[2]["values"][0]["userEnteredValue"], {"stringValue": ROW["number"]})

    def test_unverified_readback_blocks_destination(self):
        self.api.corrupt_readback = True
        self.error(502)
        self.error(425, "b")
        self.assertEqual(len(self.api.batches), 1)

    def test_rejected_atomic_batch_does_not_partially_modify_grid(self):
        before = deepcopy(self.api.rows)
        self.api.invalid_batch = True
        self.error(502)
        self.assertEqual(self.api.rows, before)
        self.error(425, "b")

    def test_durable_guard_serializes_distinct_concurrent_requests(self):
        first = self.writer()
        second = self.writer()
        self.api.started = threading.Event()
        self.api.continue_preflight = threading.Event()
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(first, "a", ROW)
            self.assertTrue(self.api.started.wait(3))
            try:
                with self.assertRaises(HTTPException) as raised:
                    second("b", {**ROW, "number": "OTHER"})
                self.assertEqual(raised.exception.status_code, 425)
            finally:
                self.api.continue_preflight.set()
            self.assertFalse(future.result(timeout=5)["duplicate"])
        self.assertEqual(len(self.api.batches), 1)

    def test_helper_rejects_unsupported_coordinates_and_env_requires_explicit_mode(self):
        for coordinates in ((True, 1, 1), (SHEET_ID, 0, 1), (SHEET_ID, 10000, 1)):
            with self.assertRaises(ValueError):
                build_payments_batch(*coordinates, {**ROW, "actor": "Герман"})
        config_file = self.path.with_name("sheets.json")
        token_file = self.path.with_name("synthetic-token.txt")
        token_file.write_text("synthetic-token", encoding="utf-8")
        config = {"mode": "payments_v1", "spreadsheet": "synthetic-test", "tab": TAB,
                  "sheet_id": SHEET_ID, "actors": {"a": "Герман"}, "token_file": str(token_file),
                  "coordinated_writes": True}
        config_file.write_text(json.dumps(config), encoding="utf-8")
        from backend.app import from_env
        with patch.dict("os.environ", {"WORKSPACE_SHEETS_ENABLED": "true",
                        "WORKSPACE_SHEETS_CONFIG": str(config_file), "DATABASE_PATH": str(self.path),
                        "APP_ORIGIN": "https://synthetic.test"}), patch("backend.app.create_app") as create:
            from_env()
            self.assertIsInstance(create.call_args.args[2], PaymentsSheetWriter)
            del config["coordinated_writes"]
            config_file.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "coordinated"):
                from_env()
            config["mode"] = "unsupported"
            config_file.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaises(ValueError):
                from_env()


if __name__ == "__main__":
    unittest.main()
