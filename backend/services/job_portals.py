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
    # Gap-audit addition (2026-09-02) - a genuinely distinct entry from
    # the plain 'whatsapp' row above: that one is the existing manual
    # wa.me deep-link for forwarding one job to one contact. This is the
    # real, automated WhatsApp Channel broadcast (one-to-many, via WAHA's
    # own /api/sendText against an @newsletter chatId) - share_intent is
    # deliberately False, since a private channel has no public compose-
    # intent URL scheme the way a 1:1 chat does; integration_type flips
    # to 'auto_api' once a real channel is connected, same convention as
    # facebook/telegram below.
    ('whatsapp_channel', 'WhatsApp Channel',   'social', 'https://waha.devlike.pro/whatsapp-channels/', False),

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
    ('techfetch',     'TechFetch (SAP/Enterprise IT)','tech','https://www.techfetch.com', False),
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
    ('drjobs',        'Dr.Jobs',               'gulf', 'https://www.drjobs.ae', False),

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
    # Round 2 (2026-08-08 free-board research, confirmed via Zoho Recruit's
    # own published free-board list) — meta-search/aggregator sites that
    # accept free listings the same way Jooble/Adzuna/Trovit already do.
    ('jobrapido',     'Jobrapido',             'aggregator', 'https://www.jobrapido.com', False),
    ('jobisjob',      'JobisJob',              'aggregator', 'https://www.jobisjob.com', False),
    ('recruitnet',    'Recruit.net',           'aggregator', 'https://www.recruit.net', False),
    ('gigajob',       'Gigajob',               'aggregator', 'https://www.gigajob.com', False),
    ('expertini',     'Expertini',             'aggregator', 'https://www.expertini.com', False),
    ('tiptopjob',     'Tip Top Job',           'aggregator', 'https://www.tiptopjob.com', False),
    ('whatjobs',      'WhatJobs',              'aggregator', 'https://www.whatjobs.com', False),
    ('postjobfree',   'PostJobFree',           'aggregator', 'https://www.postjobfree.com', False),
    ('applymyjobs',   'ApplyMyJobs (AU/NZ)',   'aggregator', 'https://www.applymyjobs.com.au', False),

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


# Integration type, for the status dashboard - what "posted here" actually
# means differs by portal, and conflating them would misrepresent delivery:
#   auto_share    - a real pre-filled share/compose URL opens with zero typing
#   auto_feed     - registered once (see /job-sharing/feed-info), then every
#                   future job is picked up automatically on the portal's own
#                   crawl schedule - no per-job action at all
#   auto_indexed  - Google for Jobs: crawls the public careers page's
#                   schema.org/JobPosting data on its own; nothing to trigger
#   manual        - no API/feed exists; a human has to click through, paste,
#                   and submit on the portal's own site
_FEED_ELIGIBLE = {'indeed', 'jooble'}
_INDEXED = {'google_jobs'}

# "Path to Full Auto-Distribution" research (2026-09-02) — every real,
# currently-active, genuinely free XML-feed publisher/partner program
# confirmed against each board's own current page, not carried forward
# from memory. Every one works the exact same way: register the app's
# already-existing /api/public/jobs/feed.xml URL once via the real form
# at `url`, then every future open job is picked up automatically,
# forever — the same real mechanism this codebase already uses for
# Indeed/Jooble, just extended to the 5 more boards this research
# confirmed also genuinely offer it for free. The registration itself is
# a real, one-time human action (needs the agency's own contact/business
# details and agreement to each board's terms) - no backend call can
# complete it on a tenant's behalf, which is why this is a real,
# self-reported "mark as done" record (feed_registrations), not an
# automated connect flow like Facebook/Telegram/WhatsApp Channel.
FREE_FEED_PROGRAMS = [
    {
        "key": "indeed", "name": "Indeed (free organic listings)",
        "url": "https://employers.indeed.com",
        "how": "Indeed Employer Center → Post a job → \"Import via XML feed\" (or Publisher Program signup), paste the Feed URL below.",
    },
    {
        "key": "jooble", "name": "Jooble",
        "url": "https://jooble.org/publishers",
        "how": "Jooble Publisher Program signup, submit the Feed URL for automatic crawling.",
    },
    {
        "key": "careerjet", "name": "Careerjet",
        "url": "https://www.careerjet.com/partners/publishers",
        "how": "Confirmed real, free publisher XML feed program - submit a publisher application with the Feed URL below.",
    },
    {
        "key": "adzuna", "name": "Adzuna",
        "url": "https://www.adzuna.com/hire/ats-integration/",
        "how": "Confirmed real, free feed for an employer's own organic jobs - contact Adzuna directly via their ATS-integration page with the Feed URL below.",
    },
    {
        "key": "trovit", "name": "Trovit Jobs",
        "url": "https://corporate.trovit.com/partners/",
        "how": "Confirmed real, free feed sync via Trovit's Partners program - strong reach across Europe/Latin America audiences too.",
    },
    {
        "key": "jora", "name": "Jora",
        "url": "https://au.jora.com/cms/get-your-feed-included-on-jora",
        "how": "Confirmed real and explicitly free - send the Feed URL via Jora's contact form; live within 2-24 hours on their own crawl schedule.",
    },
    {
        "key": "jobrapido", "name": "Jobrapido",
        "url": "https://support.jobrapido.com/hc/en-us/articles/360019196973-FEED-XML-how-can-I-send-my-feed-to-Jobrapido",
        "how": "Confirmed real, free XML feed integration - jobs typically live within 24 hours once the feed is registered.",
    },
]


def integration_type(key: str, share_intent: bool) -> str:
    if share_intent:
        return 'auto_share'
    if key in _INDEXED:
        return 'auto_indexed'
    if key in _FEED_ELIGIBLE:
        return 'auto_feed'
    return 'manual'


INTEGRATION_LABELS = {
    'auto_share': 'Auto-Share (zero click)',
    'auto_feed': 'Auto-Feed (registered once)',
    'auto_indexed': 'Auto-Indexed (Google for Jobs)',
    'auto_api': 'Auto-Post (connected API)',
    'manual': 'Manual (click-through)',
}


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
            'integration_type': integration_type(key, share_intent),
            'link': share_links.get(key, homepage) if share_intent else homepage,
        })
    return out


def portal_count() -> int:
    return len(_PORTALS)
