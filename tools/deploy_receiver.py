"""Build or deploy the complete Apps Script receiver through the user's clasp login.

Preview: python tools/deploy_receiver.py
Deploy:  python tools/deploy_receiver.py --apply --script-id ID --deployment-id ID
Clones and privately backs up the existing project BEFORE replacing its source.
The existing deployment URL, Script Properties and spreadsheet data are retained.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ['WebsiteReceiver.gs', 'AppFeedbackReceiverPatch.gs', 'UXTestsReceiverPatch.gs', 'AnalyticsEventsReceiverPatch.gs']

def bundle():
    return '// Lightning complete receiver — 2026-10-18\n// Install this one file OR the four source files, never both.\n\n' + '\n\n'.join(
        '// ===== ' + name + ' =====\n' + (ROOT / 'apps-script' / name).read_text(encoding='utf-8') for name in SOURCES)

def run(cmd, cwd):
    result = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
    if result.returncode:
        # Existing project code and authentication data are never printed.
        raise RuntimeError(f'{cmd[0]} {cmd[1]} failed. Check clasp authentication, Script API access and project ownership.')
    return result.stdout

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--script-id', help='Existing Apps Script project ID, not the /exec deployment ID')
    p.add_argument('--deployment-id', help='Existing web app deployment ID from its /s/ID/exec URL')
    p.add_argument('--output', type=Path, default=ROOT / 'LightningAppsScript.gs')
    args = p.parse_args(argv)
    text = bundle()
    args.output.write_text(text, encoding='utf-8')
    print('Complete source:', args.output)
    if not args.apply:
        print('Preview only. --apply backs up and replaces project code, then updates the EXISTING deployment.')
        print('The replacement routes survey, signup, app_feedback, ux_test, analytics events and dashboard POST reads.')
        print('Survey/signup use new v2 tabs; existing tabs and Script Properties are not deleted.')
        return 0
    clasp = shutil.which('clasp')
    if not clasp:
        raise RuntimeError('Install @google/clasp with npm, then run clasp login. The Google Apps Script API must be enabled.')
    script = args.script_id or input('Existing Apps Script project ID (Project Settings): ').strip()
    deployment = args.deployment_id or input('Existing web-app deployment ID (/s/ID/exec): ').strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{20,}', script) or not re.fullmatch(r'[A-Za-z0-9_-]{20,}', deployment):
        raise RuntimeError('Invalid project or deployment ID.')
    backup_root = ROOT / '.security-backups'
    backup_root.mkdir(mode=0o700, exist_ok=True)
    from datetime import datetime, timezone
    stamp = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    with tempfile.TemporaryDirectory(prefix='lightning-appscript-') as folder:
        stage = Path(folder)
        run([clasp, 'clone', script], stage)
        manifest_path = stage / 'appsscript.json'
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        backup = backup_root / f'appscript-before-security-{stamp}.zip'
        # Contains the previous source, possibly private configuration. Keep it out of Git.
        with zipfile.ZipFile(backup, 'w', zipfile.ZIP_DEFLATED) as archive:
            for file in stage.rglob('*'):
                if file.is_file():
                    archive.write(file, file.relative_to(stage))
        backup.chmod(0o600)
        print('Private project backup:', backup)
        manifest['runtimeVersion'] = 'V8'
        if 'oauthScopes' in manifest:
            manifest['oauthScopes'] = sorted(set(manifest['oauthScopes']) | {
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive',
                'https://www.googleapis.com/auth/script.scriptapp'})
        # A complete replacement, not an append: duplicate global constants/entry points would break deployment.
        for file in list(stage.iterdir()):
            if file.is_dir():
                shutil.rmtree(file)
            else:
                file.unlink()
        (stage / '.clasp.json').write_text(json.dumps({'scriptId': script, 'rootDir': '.'}), encoding='utf-8')
        (stage / 'appsscript.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        (stage / 'LightningReceiver.gs').write_text(text, encoding='utf-8')
        run([clasp, 'push', '--force'], stage)
        version_output = run([clasp, 'version', 'Lightning form and analytics security'], stage)
        match = re.search(r'(?:Created version|Version)\s+(\d+)', version_output, re.I)
        if not match:
            raise RuntimeError('Source was pushed but no version number was recognized. Deploy a new version through the editor.')
        run([clasp, 'deploy', '--deploymentId', deployment, '--versionNumber', match[1],
             '--description', 'Lightning form and analytics security'], stage)
    print('Existing deployment updated. Reauthorize Google scopes in the editor if requested.')
    print('For a standalone project set WEBSITE_FORMS_SPREADSHEET_ID privately; a bound project uses its existing spreadsheet.')
    print('Run rotateAnalyticsReadKey from the Apps Script editor; update the website GitHub secret from the private Dashboard key tab.')
    print('Then publish the website PR and verify a dummy submission, rejected GET analytics read, and browser confirmation.')
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as exc:
        raise SystemExit(str(exc))
