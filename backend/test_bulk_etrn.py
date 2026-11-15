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

    def test_signed_requires_existing_document_number(self):
        with self.assertRaises(ValueError):
            apply_bulk_etrn(self.order, "signed")
        source = {"number": "A1", "etrn": {"created": True, "number": "ETRN-1", "required": True}}
        self.assertTrue(apply_bulk_etrn(source, "signed")["etrn"]["allSigned"])

    def test_no_bulk_rollback_of_signed_document(self):
        source = {"etrn": {"created": True, "allSigned": True, "number": "ETRN-1", "required": True}}
        for choice in ("created", "not-required", "manual"):
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
