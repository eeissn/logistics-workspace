"""Opt-in, schema-bound insertion into the approved payments layout.

Only a coordinated Workspace writer is serialized. External human row changes
are not covered by a Google revision precondition; readback fails closed.
"""
from datetime import date
from decimal import Decimal, InvalidOperation
import hashlib
import json
from urllib.parse import urlencode

from backend.sheets import FIELDS, SheetWriter


PAYMENTS_HEADERS = (
    "Заявка", "Перевозчик", "Сумма", "Примечание", "Чей перевозчик ?",
    "Оплатили ?", "Правильный спутник?", "НП", "Первое обращение (дата)",
    "Дней прошло (б.д.)", "SortKey", "Обещали оплатить (дата)",
    "Примечание (оплатили часть и т.д.)",
)
PAYMENTS_COLUMNS = {"number": 0, "title": 1, "amount": 2, "actor": 4,
                    "requested": 8, "promised": 11}
MAX_PAYMENT_ROWS = 10000
MAX_PAYMENT_COLUMNS = 64
DATE_EPOCH = date(1899, 12, 30)
TEMPLATE_DEFAULTS = {4: {"stringValue": "НЕОБХОДИМО УКАЗАТЬ"},
                     **{column: {"boolValue": False} for column in (5, 6, 7)}}


def payment_formulas(row):
    return {
        9: f'=IF(I{row}="";"";NETWORKDAYS(I{row};TODAY())-1)',
        10: f'=IF($F{row}=TRUE;"";IF($H{row}=TRUE;100000;0)+IF($J{row}="";0;$J{row}))',
    }


def payment_values(data, row):
    result = {}
    for field, column in PAYMENTS_COLUMNS.items():
        if field == "amount":
            result[column] = {"numberValue": float(data[field])}
        elif field in ("requested", "promised"):
            result[column] = {"numberValue": (date.fromisoformat(data[field]) - DATE_EPOCH).days}
        else:
            result[column] = {"stringValue": data[field]}
    result.update({column: {"formulaValue": formula}
                   for column, formula in payment_formulas(row).items()})
    return result


def build_payments_batch(sheet_id, target_index, template_index, data):
    """Build the exact API batch; indices are zero-based, no credentials needed."""
    if (type(sheet_id) is not int or sheet_id < 0 or type(target_index) is not int or
            type(template_index) is not int or not 1 <= target_index < MAX_PAYMENT_ROWS or
            not 1 <= template_index < MAX_PAYMENT_ROWS):
        raise ValueError("Invalid payments insertion coordinates")
    source_index = template_index + (target_index <= template_index)
    source = {"sheetId": sheet_id, "startRowIndex": source_index,
              "endRowIndex": source_index + 1, "startColumnIndex": 0, "endColumnIndex": 13}
    destination = {"sheetId": sheet_id, "startRowIndex": target_index,
                   "endRowIndex": target_index + 1, "startColumnIndex": 0, "endColumnIndex": 13}
    requests = [{"insertDimension": {
        "range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": target_index,
                  "endIndex": target_index + 1},
        "inheritFromBefore": target_index > template_index}}]
    for paste_type in ("PASTE_FORMAT", "PASTE_DATA_VALIDATION"):
        requests.append({"copyPaste": {"source": source, "destination": destination,
                                      "pasteType": paste_type, "pasteOrientation": "NORMAL"}})
    for column, value in payment_values(data, target_index + 1).items():
        cell = {"userEnteredValue": value}
        fields = "userEnteredValue"
        if column in (8, 11):
            cell["userEnteredFormat"] = {"numberFormat": {"type": "DATE", "pattern": "dd.mm.yyyy"}}
            fields += ",userEnteredFormat.numberFormat"
        requests.append({"updateCells": {
            "start": {"sheetId": sheet_id, "rowIndex": target_index, "columnIndex": column},
            "rows": [{"values": [cell]}], "fields": fields}})
    return {"requests": requests}


def _cell(row, column):
    values = row.get("values", [])
    return values[column].get("userEnteredValue", {}) if column < len(values) else {}


def _meaningful(value):
    return bool(value) and value != {"stringValue": ""}


def _column_label(number):
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _plain(value):
    if "stringValue" in value:
        return value["stringValue"]
    if "numberValue" in value:
        number = Decimal(str(value["numberValue"]))
        return format(number.normalize(), "f") if number.is_finite() else None
    return None


def _same_payment(row, data):
    for field, column in PAYMENTS_COLUMNS.items():
        value = _cell(row, column)
        if field == "amount":
            try:
                if Decimal(str(value.get("numberValue", value.get("stringValue", "")))) != Decimal(str(data[field])):
                    return False
            except InvalidOperation:
                return False
        elif field in ("requested", "promised"):
            if value.get("numberValue") != (date.fromisoformat(data[field]) - DATE_EPOCH).days:
                return False
        elif _plain(value) != data[field]:
            return False
    return True


class PaymentsSheetWriter(SheetWriter):
    def __init__(self, path, spreadsheet, tab, sheet_id, actors, token,
                 coordinated_writes=False, **kwargs):
        # Explicit operator acknowledgement: Google has no revision precondition
        # here. No concurrent manual insert/delete/sort is supported by this mode.
        if coordinated_writes is not True:
            raise ValueError("Payments insertion requires explicitly coordinated writes")
        if type(sheet_id) is not int or sheet_id < 0:
            raise ValueError("Payments layout requires numeric sheet_id")
        # Reuse durable receipts, actor selection and transport without A:F append.
        super().__init__(path, spreadsheet, tab,
                         {field: field for field in FIELDS}, actors, token, **kwargs)
        self.sheet_id, self.tab = sheet_id, tab
        self.destination = (spreadsheet, tab, "payments_v1", sheet_id)
        self.guard_key = hashlib.sha256(json.dumps([spreadsheet, sheet_id]).encode()).hexdigest()
        self.document_url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet}"

    def metadata(self, token):
        fields = "spreadsheetId,sheets(properties(sheetId,title,gridProperties),merges,protectedRanges)"
        result = self.request_json(self.document_url + "?" + urlencode({"fields": fields}), token)
        sheet = self.select_sheet(result)
        properties = sheet["properties"]
        rows = properties.get("gridProperties", {}).get("rowCount", 0)
        columns = properties.get("gridProperties", {}).get("columnCount", 0)
        if (type(rows) is not int or not 2 <= rows <= MAX_PAYMENT_ROWS or
                type(columns) is not int or not 19 <= columns <= MAX_PAYMENT_COLUMNS):
            raise ValueError("Payments grid exceeds supported bounds")
        if sheet.get("merges") or sheet.get("protectedRanges"):
            raise ValueError("Merged or protected payments layout needs review")
        return rows, columns

    def select_sheet(self, result):
        if result.get("spreadsheetId") != self.destination[0]:
            raise ValueError("Wrong spreadsheet identity")
        matches = [sheet for sheet in result.get("sheets", [])
                   if sheet.get("properties", {}).get("sheetId") == self.sheet_id]
        if len(matches) != 1 or matches[0]["properties"].get("title") != self.tab:
            raise ValueError("Payments tab identity changed")
        return matches[0]

    def read_rows(self, token, start, end, columns="S"):
        quoted = "'" + self.tab.replace("'", "''") + "'"
        params = {"ranges": f"{quoted}!A{start}:{columns}{end}", "includeGridData": "true",
                  "fields": "spreadsheetId,sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue,note))))"}
        result = self.request_json(self.document_url + "?" + urlencode(params), token)
        blocks = self.select_sheet(result).get("data", [])
        if len(blocks) != 1 or blocks[0].get("startRow", 0) != start - 1 or blocks[0].get("startColumn", 0) != 0:
            raise ValueError("Unexpected payments grid response")
        rows = blocks[0].get("rowData", [])
        if len(rows) > end - start + 1:
            raise ValueError("Unbounded payments grid response")
        return rows

    def prepare(self, token, data):
        row_count, column_count = self.metadata(token)
        rows = self.read_rows(token, 1, row_count, _column_label(column_count))
        if len(rows) < 2 or tuple(_cell(rows[0], col).get("stringValue") for col in range(13)) != PAYMENTS_HEADERS:
            raise ValueError("Payments headers or template changed")
        # J/K are controlled calculations, never copied from arbitrary user input.
        for column, formula in payment_formulas(2).items():
            if _cell(rows[1], column) != {"formulaValue": formula}:
                raise ValueError("Payments formula template changed")
        last = 0
        for index, row in enumerate(rows[1:], 1):
            number = _cell(row, 0)
            if _meaningful(number):
                if "formulaValue" in number or not (_plain(number) or "").strip():
                    raise ValueError("Unsupported payments identifier cell")
                last = index
            for column, formula in payment_formulas(index + 1).items():
                value = _cell(row, column)
                if _meaningful(value) and value != {"formulaValue": formula}:
                    raise ValueError("Payments calculations changed")
        if any(_same_payment(row, data) for row in rows[1:]):
            return None
        target_index = last + 1
        if target_index >= row_count or target_index >= MAX_PAYMENT_ROWS:
            raise ValueError("Payments insertion needs an existing template row")
        # Whole-row insertion shifts every column at/below the target. Earlier
        # ancillary notes stay in place and are outside the A:M copy/write ranges.
        if any(_meaningful(cell.get("userEnteredValue", {})) or cell.get("note")
               for row in rows[target_index:] for cell in row.get("values", [])[13:]):
            raise ValueError("Ancillary payments side content would be shifted")
        for row in rows[target_index:]:
            for column, cell in enumerate(row.get("values", [])[:13]):
                value = cell.get("userEnteredValue", {})
                if cell.get("note"):
                    raise ValueError("Payments tail notes need review")
                if (not _meaningful(value) or column in (9, 10) or
                        value == TEMPLATE_DEFAULTS.get(column)):
                    continue
                raise ValueError("Payments data below last identifier needs review")
        template_index = last or 1
        return {"target_index": target_index, "expected": payment_values(data, target_index + 1),
                "batch": build_payments_batch(self.sheet_id, target_index, template_index, data)}

    def deliver(self, token, plan):
        result = self.request_json(self.document_url + ":batchUpdate", token, plan["batch"])
        if (result.get("spreadsheetId") != self.destination[0] or
                not isinstance(result.get("replies"), list) or
                len(result["replies"]) != len(plan["batch"]["requests"])):
            raise ValueError("Unconfirmed payments insertion")
        row = plan["target_index"] + 1
        rows = self.read_rows(token, row, row, "M")
        if len(rows) != 1 or any(_cell(rows[0], col) != value for col, value in plan["expected"].items()):
            raise ValueError("Payments insertion needs reconciliation")
