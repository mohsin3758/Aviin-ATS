"""
Free Job Portal Directory — curated list of 70+ real, currently-operating
free/freemium job boards for one-click requisition distribution.

Two kinds of entries:
  - share_intent=True:  the portal (or channel) accepts the job title/URL/
    description as URL query params, so a fully pre-filled compose/share
    window can be opened with zero typing (LinkedIn share, WhatsApp,
    Email, etc.) - genuinely one-click, no login page involved.
  - share_intent=False: the portal has no public URL-based posting API
    (true of nearly every free Indian job board - they require a logged-in
    employer account and their own on-site form). These link straight to
    the portal's own homepage/employer area; the job description is
    auto-copied to the clipboard so posting there is "paste + submit"
    rather than typing a listing from scratch.

Zero-token, zero-API-key - this is just a static reference list plus
URL-template formatting, no LLM/embedding call involved.
"""
from urllib.parse import urlencode, quote

CATEGORIES = [
    'social', 'general', 'tech', 'fresher_campus', 'women',
    'bluecollar_gig', 'remote_global', 'gulf', 'aggregator',
    'government', 'startup_niche',
]

# (key, name, category, homepage_url, share_intent)
_PORTALS = [
    # ── Social / direct share (auto, pre-filled, no login needed) ──────────
    ('linkedin',      'LinkedIn',              'social', 'https://www.linkedin.com', True),
    ('whatsapp',      'WhatsApp',              'social', 'https://wa.me', True),
    ('facebook',      'Facebook',              'social', 'https://www.facebook.com', True),
    ('twitter',       'X (Twitter)',           'social', 'https://twitter.com', True),
    ('telegram',      'Telegram',              'social', 'https://telegram.org', True),
    ('email',         'Email',                 'social', '', True),

    # ── General / major India job boards ────────────────────────────────────
    ('naukri',        'Naukri.com',            'general', 'https://www.naukri.com', False),
    ('indeed',        'Indeed',                'general', 'https://www.indeed.com', False),
    ('foundit',       'Foundit (Monster India)','general','https://www.foundit.in', False),
    ('shine',         'Shine.com',             'general', 'https://www.shine.com', False),
    ('timesjobs',     'TimesJobs',             'general', 'https://www.timesjobs.com', False),
    ('glassdoor',     'Glassdoor',             'general', 'https://www.glassdoor.com', False),
    ('freshersworld', 'FreshersWorld',         'general', 'https://www.freshersworld.com', False),
    ('quikr',         'Quikr Jobs',            'general', 'https://www.quikr.com', False),
    ('sulekha',       'Sulekha Jobs',          'general', 'https://www.sulekha.com', False),
    ('clickindia',    'ClickIndia Jobs',       'general', 'https://www.clickindia.com', False),
    ('justdial',      'JustDial Jobs',         'general', 'https://www.justdial.com', False),
    ('monster_global','Monster.com (Global)',  'general', 'https://www.monster.com', False),
    ('ambitionbox',   'AmbitionBox Jobs',      'general', 'https://www.ambitionbox.com', False),

    # ── Tech / IT niche ──────────────────────────────────────────────────────
    ('hirist',        'Hirist',                'tech', 'https://www.hirist.com', False),
    ('instahyre',     'Instahyre',             'tech', 'https://www.instahyre.com', False),
    ('cutshort',      'CutShort',              'tech', 'https://cutshort.io', False),
    ('wellfound',     'Wellfound (AngelList)', 'tech', 'https://wellfound.com', False),
    ('turing',        'Turing',                'tech', 'https://www.turing.com', False),
    ('toptal',        'Toptal',                'tech', 'https://www.toptal.com', False),
    ('dice',          'Dice',                  'tech', 'https://www.dice.com', False),
    ('builtin',       'BuiltIn',               'tech', 'https://builtin.com', False),
    ('dribbble',      'Dribbble Jobs',         'tech', 'https://dribbble.com/jobs', False),
    ('behance',       'Behance Jobs',          'tech', 'https://www.behance.net/joblist', False),
    ('hn_whoshiring',"HN 'Who's Hiring'",      'tech', 'https://news.ycombinator.com/submitted?id=whoishiring', False),

    # ── Fresher / campus / internship ───────────────────────────────────────
    ('internshala',   'Internshala',           'fresher_campus', 'https://internshala.com', False),
    ('letsintern',    'LetsIntern',            'fresher_campus', 'https://www.letsintern.com', False),
    ('firstnaukri',   'FirstNaukri',           'fresher_campus', 'https://www.firstnaukri.com', False),
    ('handshake',     'Handshake',             'fresher_campus', 'https://joinhandshake.com', False),

    # ── Women-focused ────────────────────────────────────────────────────────
    ('herkey',        'HerKey (JobsForHer)',   'women', 'https://www.herkey.com', False),

    # ── Blue-collar / local / gig ───────────────────────────────────────────
    ('apna',          'Apna',                  'bluecollar_gig', 'https://apna.co', False),
    ('workindia',     'WorkIndia',             'bluecollar_gig', 'https://www.workindia.in', False),
    ('upwork',        'Upwork',                'bluecollar_gig', 'https://www.upwork.com', False),
    ('freelancer',    'Freelancer.com',        'bluecollar_gig', 'https://www.freelancer.com', False),
    ('fiverr',        'Fiverr',                'bluecollar_gig', 'https://www.fiverr.com', False),

    # ── Remote / global ──────────────────────────────────────────────────────
    ('remoteok',      'RemoteOK',              'remote_global', 'https://remoteok.com', False),
    ('weworkremotely','We Work Remotely',      'remote_global', 'https://weworkremotely.com', False),
    ('flexjobs',      'FlexJobs',              'remote_global', 'https://www.flexjobs.com', False),
    ('remotive',      'Remotive',              'remote_global', 'https://remotive.com', False),
    ('justremote',    'JustRemote',            'remote_global', 'https://justremote.co', False),
    ('jobspresso',    'Jobspresso',            'remote_global', 'https://jobspresso.co', False),

    # ── Gulf / international ─────────────────────────────────────────────────
    ('naukrigulf',    'NaukriGulf',            'gulf', 'https://www.naukrigulf.com', False),
    ('bayt',          'Bayt.com',              'gulf', 'https://www.bayt.com', False),
    ('gulftalent',    'GulfTalent',            'gulf', 'https://www.gulftalent.com', False),
    ('monstergulf',   'Monster Gulf',          'gulf', 'https://www.monstergulf.com', False),

    # ── Aggregators / meta-search (index listings automatically) ───────────
    ('jooble',        'Jooble',                'aggregator', 'https://jooble.org', False),
    ('careerjet',     'CareerJet',             'aggregator', 'https://www.careerjet.co.in', False),
    ('simplyhired',   'SimplyHired',           'aggregator', 'https://www.simplyhired.com', False),
    ('jora',          'Jora',                  'aggregator', 'https://www.jora.com', False),
    ('adzuna',        'Adzuna',                'aggregator', 'https://www.adzuna.co.in', False),
    ('trovit',        'Trovit Jobs',           'aggregator', 'https://jobs.trovit.com', False),
    ('talent_com',    'Talent.com',            'aggregator', 'https://www.talent.com', False),
    ('linkup',        'LinkUp',                'aggregator', 'https://www.linkup.com', False),
    ('google_jobs',   'Google for Jobs',       'aggregator', 'https://www.google.com/search?q=jobs', False),

    # ── Government / PSU (India) ────────────────────────────────────────────
    ('ncs_gov',       'National Career Service','government', 'https://www.ncs.gov.in', False),
    ('employment_news','Employment News',      'government', 'https://www.employmentnews.gov.in', False),

    # ── Startup / gig-adjacent / niche verticals ────────────────────────────
    ('workatastartup','Work at a Startup (YC)','startup_niche', 'https://www.workatastartup.com', False),
    ('iimjobs',       'iimjobs',               'startup_niche', 'https://www.iimjobs.com', False),
    ('placementindia','PlacementIndia',        'startup_niche', 'https://www.placementindia.com', False),
    ('ziprecruiter',  'ZipRecruiter',          'startup_niche', 'https://www.ziprecruiter.com', False),
    ('careerbuilder', 'CareerBuilder',         'startup_niche', 'https://www.careerbuilder.com', False),
    ('snagajob',      'Snagajob',              'startup_niche', 'https://www.snagajob.com', False),
    ('craigslist',    'Craigslist Jobs',       'startup_niche', 'https://www.craigslist.org', False),
    ('idealist',      'Idealist (NGO/Nonprofit)','startup_niche','https://www.idealist.org', False),
    ('reed_uk',       'Reed.co.uk',            'startup_niche', 'https://www.reed.co.uk', False),
    ('totaljobs_uk',  'Totaljobs (UK)',        'startup_niche', 'https://www.totaljobs.com', False),
    ('powertofly',    'PowerToFly',            'startup_niche', 'https://powertofly.com', False),
]


def build_share_links(job_url: str, title: str, desc: str, loc: str,
                       skills: list[str], wa_msg: str) -> dict:
    """URL-encoded share links for the six genuinely pre-fillable channels."""
    return {
        'linkedin':  f"https://www.linkedin.com/sharing/share-offsite/?{urlencode({'url': job_url, 'title': title, 'summary': desc})}",
        'whatsapp':  f"https://wa.me/?text={quote(wa_msg)}",
        'facebook':  f"https://www.facebook.com/sharer/sharer.php?{urlencode({'u': job_url, 'quote': f'{title} - {loc}'})}",
        'twitter':   f"https://twitter.com/intent/tweet?{urlencode({'text': f'Hiring: {title} ({loc})', 'url': job_url})}",
        'telegram':  f"https://t.me/share/url?{urlencode({'url': job_url, 'text': f'{title} - {loc}'})}",
        'email':     f"mailto:?subject={quote(title)}&body={quote(f'{desc}\n\nApply: {job_url}')}",
    }


def get_all_portals(job_url: str = '', title: str = '', desc: str = '',
                     loc: str = '', skills: list[str] | None = None,
                     wa_msg: str = '') -> list[dict]:
    """Full catalog with a computed `link` per entry - the pre-filled share
    URL for the six auto channels, or the portal's own homepage otherwise."""
    share_links = build_share_links(job_url, title, desc, loc, skills or [], wa_msg) if job_url else {}
    out = []
    for key, name, category, homepage, share_intent in _PORTALS:
        out.append({
            'key': key,
            'name': name,
            'category': category,
            'share_intent': share_intent,
            'link': share_links.get(key, homepage) if share_intent else homepage,
        })
    return out


def portal_count() -> int:
    return len(_PORTALS)
