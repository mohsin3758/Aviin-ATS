import imaplib, base64, asyncio, asyncpg
import email as email_lib
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

ACC_ID = 'ce8e4943-2fff-49aa-bdda-f38d36a50c01'
TENANT_ID = 'a92d7fd7-fb72-47d8-881e-2493c61717ce'

async def sync_missing():
    conn = await asyncpg.connect('postgresql://app_user:apppw@db:5432/ats')

    rows = await conn.fetch(
        'SELECT imap_uid FROM imap_messages WHERE account_id=$1 AND folder=$2',
        ACC_ID, 'INBOX')
    db_uids = {r['imap_uid'] for r in rows}
    print(f'UIDs in DB: {len(db_uids)}, max: {max(int(u) for u in db_uids if str(u).isdigit())}')

    pw = base64.b64decode('U0UjQCQxMkBj').decode()
    M = imaplib.IMAP4_SSL('imap.hostinger.com', 993)
    M.login('mohsinkhan@aviintech.com', pw)
    M.select('INBOX', readonly=True)

    _, nums = M.uid('SEARCH', None, 'ALL')
    server_uids = [u.decode() for u in nums[0].split()] if nums[0] else []
    print(f'Server UIDs: {len(server_uids)}, max: {max(int(u) for u in server_uids)}')

    missing = [u for u in server_uids if u not in db_uids]
    print(f'Missing UIDs: {len(missing)}, last 5: {missing[-5:]}')

    # Sync last 100 missing (most recent emails)
    synced = 0
    for uid in missing[-100:]:
        try:
            _, hd = M.uid('FETCH', uid.encode(), '(RFC822.HEADER)')
            if not hd or not hd[0] or not isinstance(hd[0], tuple):
                continue
            msg = email_lib.message_from_bytes(hd[0][1])

            def dec(h):
                try:
                    return str(make_header(decode_header(h or '')))
                except:
                    return h or ''

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
                'INSERT INTO imap_messages'
                ' (account_id,tenant_id,imap_uid,folder,from_email,from_name,to_email,cc,subject,body,html_body,received_at)'
                ' VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)'
                ' ON CONFLICT (account_id,folder,imap_uid) DO NOTHING',
                ACC_ID, TENANT_ID, uid, 'INBOX',
                fe[:500] if fe else None, fn[:200] if fn else None,
                to_hdr[:500], cc_hdr[:500],
                subj[:500] or '(no subject)', '', None, ra)
            synced += 1
            if 'Alchemy' in subj or 'Techsol' in subj or synced <= 5:
                print(f'  Synced UID {uid}: {subj[:50]}')
        except Exception as ex:
            print(f'  Error uid={uid}: {ex}')

    M.logout()
    await conn.close()
    print(f'Done. Synced {synced} missing emails.')

asyncio.run(sync_missing())
