"""No real documents or production databases: synthetic PDF originals sizing tests."""
import unittest

from backend.pdf_originals_feasibility import benchmark, synthetic_pdf, validate_scale


class PDFOriginalsFeasibilityTests(unittest.TestCase):
    def test_two_accounts_same_order_number_restore_both_originals(self):
        report = benchmark(orders=8, pdf_kib=2)
        self.assertEqual(report["orders"], 8)
        self.assertEqual(report["files"], 16)
        self.assertEqual(report["orders_with_both_files"], 8)
        self.assertEqual(report["shared_numbers_across_accounts"], 4)
        self.assertEqual(report["integrity"], "ok")
        self.assertTrue(report["foreign_keys_ok"])
        self.assertTrue(report["restored_bytes_sha256_ok"])
        self.assertTrue(report["synthetic_only"])
        self.assertGreater(report["backup_mib"], 0)

    def test_single_order_recovery_without_cross_owner_collision(self):
        report = benchmark(orders=1, pdf_kib=1)
        self.assertEqual(report["files"], 2)
        self.assertEqual(report["shared_numbers_across_accounts"], 0)
        self.assertEqual(report["orders_with_both_files"], 1)

    def test_synthetic_bytes_are_deterministic_and_role_specific(self):
        self.assertEqual(synthetic_pdf("a:customer", 1024),
                         synthetic_pdf("a:customer", 1024))
        self.assertNotEqual(synthetic_pdf("a:customer", 1024),
                            synthetic_pdf("a:carrier", 1024))

    def test_budget_limit_blocks_oversized_benchmark(self):
        for count, size in ((0, 1), (5001, 1), (2, 0), (2, 257),
                            (1025, 256), (2.5, 5), (2, 1.5)):
            with self.subTest(count=count, size=size):
                with self.assertRaises(ValueError):
                    validate_scale(count, size)


if __name__ == "__main__":
    unittest.main()
