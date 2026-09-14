"""WhatsApp automation research (2026-09-15), gaps #6 (cross-requisition
job matching) and #4 (cold-candidate re-engagement) share the exact same
underlying question: "is there an open requisition this candidate hasn't
already been considered for, that their known skills actually fit?" --
one Tier-0 SQL function, no AI call, reused by both.

mandatory_skills is TEXT[] (sql/80) and candidate_skill_experience.
skill_name is populated by the screening skill-question loop itself
(services/screening_extraction.py) -- the array-overlap (&&) check below
only ever matches on skills THIS candidate has actually told us about,
never a guess.
"""


async def find_open_requisition_match(conn, tenant_id: str, candidate_id: str) -> dict | None:
    """The NOT EXISTS clause excludes any requisition the candidate
    already has a real applications row against -- which, since
    enroll_candidate_for_screening always creates one at enrollment,
    naturally excludes the current/just-screened requisition too, with
    no separate exclude-list parameter needed."""
    row = await conn.fetchrow(
        """SELECT r.id, r.title, cl.name AS client_name
           FROM requisitions r
           LEFT JOIN clients cl ON cl.id = r.client_id
           WHERE r.tenant_id=$1 AND r.is_active IS NOT FALSE
             AND r.mandatory_skills IS NOT NULL
             AND r.mandatory_skills && (
               SELECT array_agg(DISTINCT skill_name) FROM candidate_skill_experience
               WHERE tenant_id=$1 AND candidate_id=$2)
             AND NOT EXISTS (
               SELECT 1 FROM applications a
               WHERE a.tenant_id=$1 AND a.candidate_id=$2 AND a.requisition_id=r.id)
           ORDER BY r.created_at DESC LIMIT 1""",
        tenant_id, candidate_id)
    return dict(row) if row else None
