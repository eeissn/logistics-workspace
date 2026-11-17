import unittest

from backend.bulk_etrn import apply_bulk_etrn


class BulkEtrnTest(unittest.TestCase):
    def setUp(self):
        self.order = {"number": "A1", "trip": {"stage": "loaded"}, "etrn": {"required": True, "number": ""}}

    def test_created_preserves_unrelated_fields(self):
        result = apply_bulk_etrn(self.order, "created")
        self.assertTrue(result["etrn"]["created"])
        self.assertEqual(result["trip"], self.order["trip"])
        self.assertNotIn("created", self.order["etrn"])

    def test_signed_defaults_to_agreement_number_without_faking_signature_steps(self):
        signed = apply_bulk_etrn(self.order, "signed")
        self.assertEqual(signed["etrn"]["number"], "A1")
        self.assertTrue(signed["etrn"]["created"])
        self.assertTrue(signed["etrn"]["allSigned"])
        self.assertNotIn("sender", signed["etrn"])
        self.assertEqual(self.order["etrn"]["number"], "")

    def test_signed_preserves_existing_number_and_allows_per_order_override(self):
        source = {"number": "A1", "etrn": {"created": True, "number": "ETRN-1",
                                          "required": True, "sender": True}}
        self.assertEqual(apply_bulk_etrn(source, "signed")["etrn"]["number"], "ETRN-1")
        updated = apply_bulk_etrn(source, "signed", "CORRECTED-1")
        self.assertEqual(updated["etrn"]["number"], "CORRECTED-1")
        self.assertTrue(updated["etrn"]["sender"])
        self.assertEqual(source["etrn"]["number"], "ETRN-1")
        self.assertEqual(apply_bulk_etrn(self.order, "created")["etrn"]["number"], "A1")
        for value in ("", " " * 2, "abc\n123", "a" * 81, 123):
            with self.subTest(value=value), self.assertRaises(ValueError):
                apply_bulk_etrn(source, "signed", value)
        with self.assertRaises(ValueError):
            apply_bulk_etrn(source, "manual", "NEW")

    def test_correct_accidental_signed_status_without_losing_number(self):
        source = {"etrn": {"created": True, "allSigned": True, "number": "ETRN-1",
                           "sender": True, "pickupCarrier": False, "required": True}}
        result = apply_bulk_etrn(source, "created")
        self.assertFalse(result["etrn"]["allSigned"])
        self.assertTrue(result["etrn"]["created"])
        self.assertEqual(result["etrn"]["number"], "ETRN-1")
        self.assertTrue(result["etrn"]["sender"])
        self.assertTrue(source["etrn"]["allSigned"])

    def test_cannot_erase_four_recorded_signatures(self):
        source = {"etrn": {"created": True, "allSigned": True, "number": "ETRN-1",
                           "sender": True, "pickupCarrier": True, "recipient": True,
                           "deliveryCarrier": True, "required": True}}
        with self.assertRaises(ValueError):
            apply_bulk_etrn(source, "created")

    def test_still_blocks_disabling_or_manual_closing_signed_document(self):
        source = {"etrn": {"created": True, "allSigned": True, "number": "ETRN-1", "required": True}}
        for choice in ("not-required", "manual"):
            with self.subTest(choice=choice), self.assertRaises(ValueError):
                apply_bulk_etrn(source, choice)

    def test_not_required_without_document(self):
        result = apply_bulk_etrn(self.order, "not-required")
        self.assertFalse(result["etrn"]["required"])

    def test_manual_close(self):
        result = apply_bulk_etrn(self.order, "manual")
        self.assertTrue(result["etrn"]["manualComplete"])

    def test_invalid_status(self):
        with self.assertRaises(ValueError):
            apply_bulk_etrn(self.order, "fake")


if __name__ == "__main__":
    unittest.main()
