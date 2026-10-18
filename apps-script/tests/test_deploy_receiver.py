"""Deployment must preserve a private backup and never mutate on preview."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('deploy_receiver', ROOT / 'tools/deploy_receiver.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DeployReceiverTests(unittest.TestCase):
    def test_preview_builds_one_router_without_running_clasp(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(module, 'run', side_effect=AssertionError('must not contact Google')):
            output = Path(folder) / 'receiver.gs'
            self.assertEqual(module.main(['--output', str(output)]), 0)
            code = output.read_text()
            self.assertEqual(code.count('function doPost('), 1)
            self.assertEqual(code.count('function doGet('), 1)
            self.assertIn('function saveAppFeedback_', code)
            self.assertIn('function websiteAdmission_', code)

    def test_project_is_backed_up_before_source_is_replaced(self):
        original_root = module.ROOT
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'apps-script').mkdir()
            for source in module.SOURCES:
                (root / 'apps-script' / source).write_text((original_root / 'apps-script' / source).read_text())
            calls = []
            def run(command, cwd):
                calls.append(command[1])
                if command[1] == 'clone':
                    (cwd / 'Code.js').write_text('old project source')
                    (cwd / 'appsscript.json').write_text('{"timeZone":"Africa/Cairo"}')
                if command[1] == 'push':
                    backups = list((root / '.security-backups').glob('*.zip'))
                    self.assertEqual(len(backups), 1)
                    with zipfile.ZipFile(backups[0]) as backup:
                        self.assertEqual(backup.read('Code.js').decode(), 'old project source')
                    self.assertFalse((cwd / 'Code.js').exists())
                    self.assertTrue((cwd / 'LightningReceiver.gs').is_file())
                return 'Created version 12.' if command[1] == 'version' else ''
            with patch.object(module, 'ROOT', root), patch.object(module.shutil, 'which', return_value='clasp'), patch.object(module, 'run', side_effect=run):
                self.assertEqual(module.main(['--apply', '--script-id', 'a'*30, '--deployment-id', 'b'*30, '--output', str(root/'bundle.gs')]), 0)
            self.assertEqual(calls, ['clone', 'push', 'version', 'deploy'])

if __name__ == '__main__':
    unittest.main()
