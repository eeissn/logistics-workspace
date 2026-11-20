"""Validation of bulk ETRN status updates; never erase signed document metadata."""

from copy import deepcopy

CHOICES = {
    "created": "Создана ЭТРН",
    "signed": "Подписана",
    "not-required": "Не требуется",
    "manual": "Закрыта вручную",
}


def apply_bulk_etrn(order, choice, number_override=None):
    if not isinstance(choice, str) or choice not in CHOICES:
        raise ValueError("Неизвестный статус ЭТРН.")
    updated = deepcopy(order)
    etrn = updated.get("etrn")
    if not isinstance(etrn, dict):
        raise ValueError("Некорректные данные ЭТРН.")
    etrn = dict(etrn)
    if number_override is not None:
        if choice not in ("created", "signed"):
            raise ValueError("Номер можно менять только при создании или подписании ЭТРН.")
        if (not isinstance(number_override, str) or
            not 1 <= len(number_override) <= 80 or
            number_override != number_override.strip() or
            any(ord(char) < 32 for char in number_override)):
            raise ValueError("Укажи корректный номер ЭТРН (до 80 символов).")
        etrn["number"] = number_override
    if choice in ("created", "signed"):
        # Per-order default: agreement/order number, never one shared bulk number.
        if not str(etrn.get("number", "")).strip():
            fallback = order.get("number", "")
            if not isinstance(fallback, str) or not 1 <= len(fallback) <= 48:
                raise ValueError("У заявки нет номера для ЭТРН.")
            etrn["number"] = fallback
    if choice == "created":
        if etrn.get("manualComplete"):
            raise ValueError("ЭТРН уже закрыта вручную.")
        # allSigned can be a manually selected summary, not evidence of signatures.
        # Preserve each actual signature field; disallow overriding four recorded signatures.
        if all(etrn.get(key) for key in ("sender", "pickupCarrier", "recipient", "deliveryCarrier")):
            raise ValueError("Зафиксированы все четыре подписи; проверьте документ вручную.")
        etrn["required"] = True
        etrn["created"] = True
        etrn["allSigned"] = False
        etrn["manualComplete"] = False
    elif choice == "signed":
        if etrn.get("manualComplete"):
            raise ValueError("ЭТРН закрыта вручную.")
        # Explicit operator confirmation records a signed summary and document.
        # Never invent or overwrite the four individual signature fields.
        etrn["required"] = True
        etrn["created"] = True
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
