from pathlib import Path

path = Path('.tmp/apply-settings-search.py')
lines = path.read_text().splitlines()
for index, line in enumerate(lines):
    if 'intelligence.summary ||' in line:
        lines[index] = '    "{intelligence.summary || \'Results for \\\"\' + intelligence.query + \'\\\" using the \' + intelligence.lens + \' lens.\'}\\n",'
    elif line.strip() == '"                   {intelligence.summary}\\n"':
        lines[index] = '    "{intelligence.summary}\\n"'
    elif '<SearchResultCard key={result.url' in line and 'settings={settings}' not in line:
        lines[index] = '    "<SearchResultCard key={result.url + \'-\' + index} result={result} index={index} />\\n",'
    elif '<SearchResultCard key={result.url' in line and 'settings={settings}' in line:
        lines[index] = '    "<SearchResultCard key={result.url + \'-\' + index} result={result} index={index} settings={settings} />\\n"'
path.write_text('\n'.join(lines) + '\n')
