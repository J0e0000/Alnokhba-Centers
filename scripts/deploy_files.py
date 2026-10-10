#!/usr/bin/env python3
"""Deploy the reconstructed AlNokhba Centers codebase onto the fresh scaffold."""
import json
import os
import shutil

MY = '/home/z/my-project'
deploy = json.load(open(f'{MY}/reconstruct/deploy_set.json'))

# 1. Clean scaffold dirs that we replace wholesale (keep src/components/ui - shadcn, keep src/hooks, src/lib from scaffold where needed)
# Careful: we replace src/app, src/components/nokhba, src/lib (project libs), prisma, public, scripts
# but keep scaffold's src/components/ui (shadcn), src/hooks (use-toast etc.)

# Remove scaffold's default src/app page content first
scaffold_app = f'{MY}/src/app'
if os.path.exists(scaffold_app):
    shutil.rmtree(scaffold_app)

# Remove scaffold's lib files that the project replaces (keep if not in deploy)
scaffold_lib = f'{MY}/src/lib'
scaffold_lib_files = {}
if os.path.exists(scaffold_lib):
    for f in os.listdir(scaffold_lib):
        scaffold_lib_files[f] = open(f'{scaffold_lib}/{f}').read()

# 2. Write all deploy files
written = 0
for rel, content in deploy.items():
    if rel == 'package.json':
        continue  # handled separately
    path = os.path.join(MY, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    written += 1

print(f'Wrote {written} files')

# 3. Merge package.json: template + project deps
template_pkg = json.load(open(f'{MY}/package.json'))
recovered_pkg = json.loads(deploy['package.json'])

extra_deps = {
    'qrcode': '^1.5.4',
    'html5-qrcode': '^2.3.8',
    'exceljs': '^4.4.0',
    'web-push': '^3.6.7',
}
extra_dev = {
    '@types/qrcode': '^1.5.5',
    '@types/web-push': '^3.6.4',
}

merged = dict(template_pkg)
# keep recovered scripts (they match the template anyway)
merged['scripts'] = recovered_pkg.get('scripts', template_pkg['scripts'])
deps = dict(template_pkg.get('dependencies', {}))
deps.update(extra_deps)
devdeps = dict(template_pkg.get('devDependencies', {}))
devdeps.update(extra_dev)
merged['dependencies'] = deps
merged['devDependencies'] = devdeps

with open(f'{MY}/package.json', 'w') as f:
    json.dump(merged, f, indent=2)
print('package.json merged with extra deps:', list(extra_deps.keys()))

# 4. List what scaffold lib files were replaced vs preserved
print('\nScaffold lib files preserved:')
deploy_libs = {r.split('/', 2)[2] for r in deploy if r.startswith('src/lib/')}
for f in scaffold_lib_files:
    if f not in deploy_libs:
        print('  kept:', f)

print('\nDeploy complete.')
