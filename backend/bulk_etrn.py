"""Validation of bulk ETRN status updates; never erase signed document metadata."""

from copy import deepcopy

CHOICES = {
    "created": "Создана ЭТРН",
    "signed": "Подписана",
    "not-required": "Не требуется",
    "manual": "Закрыта вручную",
}


def apply_bulk_etrn(order, choice):
    if choice not in CHOICES:
        raise ValueError("Неизвестный статус ЭТРН.")
    updated = deepcopy(order)
    etrn = updated.get("etrn")
    if not isinstance(etrn, dict):
        raise ValueError("Некорректные данные ЭТРН.")
    etrn = dict(etrn)
    if choice == "created":
        if etrn.get("manualComplete"):
            raise ValueError("ЭТРН уже закрыта вручную.")
        if etrn.get("allSigned"):
            raise ValueError("ЭТРН уже подписана; нельзя откатить этап.")
        etrn["required"] = True
        etrn["created"] = True
        etrn["manualComplete"] = False
    elif choice == "signed":
        if etrn.get("manualComplete"):
            raise ValueError("ЭТРН закрыта вручную.")
        if not etrn.get("created") or not str(etrn.get("number", "")).strip():
            raise ValueError("Для статуса «Подписана» нужны созданная ЭТРН и её номер.")
        etrn["required"] = True
        etrn["allSigned"] = True
        etrn["manualComplete"] = False
    elif choice == "not-required":
        if etrn.get("created") or etrn.get("allSigned") or str(etrn.get("number", "")).strip():
            raise ValueError("Существующую ЭТРН нельзя отключить массово.")
        etrn["required"] = False
        etrn["manualComplete"] = False
    else:
        if etrn.get("allSigned"):
            raise ValueError("Уже подписанную ЭТРН нельзя закрыть вручную.")
        etrn["required"] = True
        etrn["manualComplete"] = True
    updated["etrn"] = etrn
    return updated
