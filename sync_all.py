"""Sync ALL missing INBOX emails from server (with real UIDs) to DB"""
import imaplib, base64, asyncio, asyncpg
import email as email_lib
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

ACC_ID = 'ce8e4943-2fff-49aa-bdda-f38d36a50c01'
TENANT_ID = 'a92d7fd7-fb72-47d8-881e-2493c61717ce'

async def sync_all():
    conn = await asyncpg.connect('postgresql://app_user:apppw@db:5432/ats')
    rows = await conn.fetch('SELECT imap_uid FROM imap_messages WHERE account_id=$1 AND folder=$2', ACC_ID, 'INBOX')
    db_uids = {r['imap_uid'] for r in rows}

    pw = base64.b64decode('U0UjQCQxMkBj').decode()
    M = imaplib.IMAP4_SSL('imap.hostinger.com', 993)
    M.login('mohsinkhan@aviintech.com', pw)
    M.select('INBOX', readonly=True)

    _, nums = M.uid('SEARCH', None, 'ALL')
    server_uids = [u.decode() for u in nums[0].split()] if nums[0] else []
    missing = [u for u in server_uids if u not in db_uids]
    print(f'Missing: {len(missing)} emails to sync')

    synced = 0
    batch_size = 50
    for i in range(0, len(missing), batch_size):
        batch = missing[i:i+batch_size]
        for uid in batch:
            try:
                _, hd = M.uid('FETCH', uid.encode(), '(RFC822.HEADER)')
                if not hd or not hd[0] or not isinstance(hd[0], tuple):
                    continue
                msg = email_lib.message_from_bytes(hd[0][1])
                def dec(h):
                    try: return str(make_header(decode_header(h or '')))
                    except: return h or ''
                subj = dec(msg.get('Subject', ''))
                fr = dec(msg.get('From', ''))
                fn = fr.split('<')[0].strip().strip('"') if '<' in fr else fr.strip()
                fe = fr.split('<')[1].rstrip('>').strip() if '<' in fr else fr.strip()
                to_hdr = msg.get('To', '')
                cc_hdr = msg.get('Cc', '')
                try:
                    ra = parsedate_to_datetime(msg.get('Date', ''))
                except:
                    ra = datetime.now(timezone.utc)
                await conn.execute(
                    'INSERT INTO imap_messages (account_id,tenant_id,imap_uid,folder,from_email,from_name,to_email,cc,subject,body,html_body,received_at)'
                    ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)'
                    ' ON CONFLICT (account_id,folder,imap_uid) DO NOTHING',
                    ACC_ID, TENANT_ID, uid, 'INBOX',
                    fe[:500] if fe else None, fn[:200] if fn else None,
                    to_hdr[:500], cc_hdr[:500],
                    subj[:500] or '(no subject)', '', None, ra)
                synced += 1
            except Exception as ex:
                pass
        if synced % 500 == 0 and synced > 0:
            print(f'Progress: {synced} synced...')

    M.logout()
    await conn.close()
    print(f'Complete. Synced {synced} missing emails.')

asyncio.run(sync_all())
