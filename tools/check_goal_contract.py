from pathlib import Path

p = Path('contracts/dreaming-worker.yaml')
assert p.exists(), 'missing goal contract'
text = p.read_text(encoding='utf-8')
required = [
    'Session Search',
    'HYPOTHESIS',
    'UNKNOWN',
    'zero external model calls',
    'partial or stale coverage cannot justify absence claims',
    'general-purpose autonomous agent',
    'Mastra is a development surface',
]
missing = [x for x in required if x not in text]
assert not missing, f'missing goal invariants: {missing}'
print('goal-contract: PASS')
