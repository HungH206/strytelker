"""Sync the two program-reference offers into the project SQLite snapshot."""
import json
import sqlite3
from pathlib import Path

project = Path(__file__).resolve().parent.parent
records = json.loads((project / 'data/offers.json').read_text())
with sqlite3.connect(project / 'data/toyota_world.sqlite') as database:
    for offer in records:
        database.execute('''
            INSERT INTO offers (id, vehicle_id, offer_type, apr, term_months,
                rebate_usd, valid_until, region, source_url, is_simulated,
                verification_status)
            VALUES (?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                vehicle_id=excluded.vehicle_id, offer_type=excluded.offer_type,
                apr=excluded.apr, term_months=excluded.term_months,
                rebate_usd=excluded.rebate_usd, valid_until=excluded.valid_until,
                region=excluded.region, source_url=excluded.source_url,
                is_simulated=excluded.is_simulated,
                verification_status=excluded.verification_status
        ''', (offer['id'], offer['offer_type'], offer['rebate_usd'],
              offer['valid_until'], offer['region'], offer['source_url'],
              int(offer['is_simulated']), offer['verification_status']))
    print('Project offer records:', database.execute(
        'SELECT id, rebate_usd, is_simulated FROM offers ORDER BY id').fetchall())
