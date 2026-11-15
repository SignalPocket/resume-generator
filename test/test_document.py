"""Regression coverage for Windows LibreOffice PDF export."""
from pathlib import Path
from types import SimpleNamespace
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote, urlparse

from pypdf import PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import document


def path_from_uri(value):
    parsed = urlparse(value)
    path = unquote(parsed.path)
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return Path(path)


def write_pdf(path):
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    with path.open('wb') as stream:
        writer.write(stream)


class LibreOfficeExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='resume-export-test-')
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def long_application_directory(self):
        directory = self.root
        while len(str(directory / 'resume.docx')) < 220:
            directory /= 'application-version-output-0123456789'
        directory.mkdir(parents=True)
        return directory

    def successful_process(self, arguments, **_kwargs):
        profile_argument = next(arg for arg in arguments if arg.startswith('-env:UserInstallation='))
        profile = path_from_uri(profile_argument.split('=', 1)[1])
        output = Path(arguments[arguments.index('--outdir') + 1])
        self.assertTrue(profile.is_dir())
        self.assertTrue(output.is_dir())
        self.profiles.append(profile)
        write_pdf(output / f'{Path(arguments[-1]).stem}.pdf')
        return SimpleNamespace(returncode=0, stdout='', stderr='')

    def test_windows_long_application_path_uses_short_private_profile(self):
        application = self.long_application_directory()
        docx = application / 'resume.docx'
        pdf = application / 'resume.pdf'
        result = application / 'result.json'
        docx.write_bytes(b'docx fixture')
        self.profiles = []

        with patch.dict(os.environ, {'RESUME_SOFFICE': 'soffice-test'}), \
                patch.object(document.subprocess, 'run', side_effect=self.successful_process):
            document.export_pdf(docx, pdf, result)

        self.assertEqual(len(self.profiles), 1)
        self.assertNotIn(application, self.profiles[0].parents)
        self.assertLess(len(str(self.profiles[0])), len(str(application)))
        self.assertFalse(self.profiles[0].exists())
        self.assertTrue(pdf.is_file())
        self.assertTrue(result.is_file())

    def test_user_installation_failure_retries_once_with_new_profile(self):
        application = self.long_application_directory()
        docx = application / 'resume.docx'
        docx.write_bytes(b'docx fixture')
        self.profiles = []
        calls = 0

        def fail_then_succeed(arguments, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                profile_argument = next(arg for arg in arguments if arg.startswith('-env:UserInstallation='))
                self.profiles.append(path_from_uri(profile_argument.split('=', 1)[1]))
                return SimpleNamespace(
                    returncode=1,
                    stdout='',
                    stderr='User installation could not be completed.',
                )
            return self.successful_process(arguments, **kwargs)

        with patch.dict(os.environ, {'RESUME_SOFFICE': 'soffice-test'}), \
                patch.object(document.subprocess, 'run', side_effect=fail_then_succeed):
            document.export_pdf(docx, application / 'resume.pdf', application / 'result.json')

        self.assertEqual(calls, 2)
        self.assertEqual(len(self.profiles), 2)
        self.assertNotEqual(self.profiles[0], self.profiles[1])
        self.assertTrue(all(not profile.exists() for profile in self.profiles))

    def test_unrelated_failure_is_not_retried(self):
        application = self.long_application_directory()
        docx = application / 'resume.docx'
        docx.write_bytes(b'docx fixture')
        failed = SimpleNamespace(returncode=1, stdout='', stderr='Unrelated failure')

        with patch.dict(os.environ, {'RESUME_SOFFICE': 'soffice-test'}), \
                patch.object(document.subprocess, 'run', return_value=failed) as run:
            with self.assertRaisesRegex(RuntimeError, 'Unrelated failure'):
                document.export_pdf(docx, application / 'resume.pdf', application / 'result.json')

        run.assert_called_once()


if __name__ == '__main__':
    unittest.main()
