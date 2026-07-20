from pathlib import Path

path = Path('.tmp/apply-settings-search.py')
lines = path.read_text().splitlines()
for index, line in enumerate(lines):
    if 'intelligence.summary ||' in line:
        lines[index] = '    "{intelligence.summary || \'Results for \\\"\' + intelligence.query + \'\\\" using the \' + intelligence.lens + \' lens.\'}\\n",'
    elif line.strip() == '"                   {intelligence.summary}\\n"':
        lines[index] = '    "{intelligence.summary}\\n"'
path.write_text('\n'.join(lines) + '\n')
