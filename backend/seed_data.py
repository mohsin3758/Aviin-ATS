"""India demo data seed for AIrecruit (FinStack Staffing OS).

Run inside the backend container:
  docker compose exec backend python seed_data.py

Idempotent: skips a tenant if it already has users. Connects as
app_user (HARD RULE #9) and sets app.tenant_id (via set_config) before
every tenant-scoped insert, satisfying the FORCE RLS policies from
sql/01_phase1_schema.sql / sql/10_phase1_staffing_additions.sql.

HARD RULE #5/#6: every business insert that should notify downstream
automation also writes an event_outbox row with a dedup_key in the
same transaction.
HARD RULE #12: every candidate gets a consent_records row before any
other candidate data is considered "processed".
"""

import asyncio
import json
import os

import asyncpg
import bcrypt

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://app_user:apppw@db:5432/ats"
)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


async def set_tenant(conn: asyncpg.Connection, tenant_id) -> None:
    # session-level (not LOCAL): must persist across statements outside any
    # explicit transaction, e.g. the already_seeded() check before seeding starts
    await conn.execute("SELECT set_config('app.tenant_id', $1, false)", str(tenant_id))


async def get_or_create_tenant(conn: asyncpg.Connection, name: str, slug: str):
    row = await conn.fetchrow("SELECT id FROM tenants WHERE slug = $1", slug)
    if row:
        return row["id"], True
    row = await conn.fetchrow(
        "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id", name, slug
    )
    return row["id"], False


async def already_seeded(conn: asyncpg.Connection, tenant_id) -> bool:
    await set_tenant(conn, tenant_id)
    n = await conn.fetchval("SELECT count(*) FROM users")
    return n > 0


CLIENTS = [
    ("TechNova Solutions", "IT Services"),
    ("Bharat FinServ", "BFSI"),
    ("Globex Manufacturing India", "Manufacturing"),
]

REQUISITIONS = [
    dict(
        title="Senior Python Backend Engineer",
        client="TechNova Solutions",
        skills_required=["Python", "FastAPI", "PostgreSQL", "AWS"],
        location="Bengaluru",
        employment_type="contract",
        positions_count=2,
        sla_hours=120,
        description="Senior backend role building FastAPI + PostgreSQL "
        "microservices on AWS for a Bengaluru-based product team.",
    ),
    dict(
        title="React Frontend Developer",
        client="TechNova Solutions",
        skills_required=["React", "TypeScript", "Next.js", "Tailwind"],
        location="Hyderabad",
        employment_type="c2h",
        positions_count=1,
        sla_hours=96,
        description="Frontend developer for a Next.js + TypeScript + "
        "Tailwind SaaS dashboard, contract-to-hire in Hyderabad.",
    ),
    dict(
        title="Business Analyst - BFSI",
        client="Bharat FinServ",
        skills_required=["SQL", "Excel", "Financial Modeling", "Stakeholder Management"],
        location="Mumbai",
        employment_type="fulltime",
        positions_count=1,
        sla_hours=168,
        description="Business analyst supporting financial modeling and "
        "stakeholder reporting for a Mumbai BFSI client.",
    ),
    dict(
        title="DevOps Engineer",
        client="Globex Manufacturing India",
        skills_required=["Docker", "Kubernetes", "CI/CD", "Linux"],
        location="Pune",
        employment_type="contract",
        positions_count=1,
        sla_hours=120,
        description="DevOps engineer to build CI/CD pipelines and manage "
        "Kubernetes clusters for manufacturing plant systems in Pune.",
    ),
    dict(
        title="QA Automation Engineer",
        client="TechNova Solutions",
        skills_required=["Playwright", "Selenium", "Python", "API Testing"],
        location="Bengaluru",
        employment_type="c2h",
        positions_count=2,
        sla_hours=96,
        description="QA automation engineer writing Playwright/Selenium "
        "and API test suites for a Bengaluru product team.",
    ),
    dict(
        title="Java Backend Developer - Microservices",
        client="Globex Manufacturing India",
        skills_required=["Java", "Spring Boot", "Microservices", "Kafka"],
        location="Bengaluru",
        employment_type="contract",
        positions_count=1,
        sla_hours=120,
        description="Java/Spring Boot microservices developer with Kafka "
        "experience for a manufacturing ERP integration project.",
    ),
]

CANDIDATES = [
    dict(
        full_name="Aarav Sharma",
        email="aarav.sharma@example.com",
        phone="+91-90000-00001",
        skills=["Python", "FastAPI", "PostgreSQL", "Docker", "AWS"],
        total_exp_mo=60,
        location="Bengaluru",
        current_employer="Tech Mahindra",
        source="referral",
        resume_text="Aarav Sharma - Senior Python Backend Engineer with 5 "
        "years experience in FastAPI, PostgreSQL, Docker and AWS, based "
        "in Bengaluru.",
    ),
    dict(
        full_name="Priya Nair",
        email="priya.nair@example.com",
        phone="+91-90000-00002",
        skills=["React", "TypeScript", "Next.js", "Redux"],
        total_exp_mo=36,
        location="Hyderabad",
        current_employer="Infosys",
        source="job_board",
        resume_text="Priya Nair - Frontend developer with 3 years "
        "experience building React, TypeScript, Next.js and Redux "
        "applications, based in Hyderabad.",
    ),
    dict(
        full_name="Rohan Mehta",
        email="rohan.mehta@example.com",
        phone="+91-90000-00003",
        skills=["SQL", "Excel", "Power BI", "Financial Modeling"],
        total_exp_mo=84,
        location="Mumbai",
        current_employer="ICICI Bank",
        source="referral",
        resume_text="Rohan Mehta - Business analyst with 7 years "
        "experience in SQL, Excel, Power BI and financial modeling for "
        "BFSI clients, based in Mumbai.",
    ),
    dict(
        full_name="Sneha Iyer",
        email="sneha.iyer@example.com",
        phone="+91-90000-00004",
        skills=["Kubernetes", "Docker", "AWS", "Terraform", "Linux"],
        total_exp_mo=72,
        location="Pune",
        current_employer="Wipro",
        source="job_board",
        resume_text="Sneha Iyer - DevOps engineer with 6 years experience "
        "in Kubernetes, Docker, AWS, Terraform and Linux systems "
        "administration, based in Pune.",
    ),
    dict(
        full_name="Vikram Singh",
        email="vikram.singh@example.com",
        phone="+91-90000-00005",
        skills=["Python", "Selenium", "Playwright", "API Testing"],
        total_exp_mo=48,
        location="Bengaluru",
        current_employer="Cognizant",
        source="referral",
        resume_text="Vikram Singh - QA automation engineer with 4 years "
        "experience in Python, Selenium, Playwright and API testing, "
        "based in Bengaluru.",
    ),
    dict(
        full_name="Ananya Reddy",
        email="ananya.reddy@example.com",
        phone="+91-90000-00006",
        skills=["Python", "Django", "PostgreSQL", "REST APIs"],
        total_exp_mo=30,
        location="Bengaluru",
        current_employer="Freelance",
        source="self_apply",
        resume_text="Ananya Reddy - Backend developer with 2.5 years "
        "experience in Python, Django, PostgreSQL and REST APIs, based "
        "in Bengaluru.",
    ),
    dict(
        full_name="Karan Malhotra",
        email="karan.malhotra@example.com",
        phone="+91-90000-00007",
        skills=["React", "JavaScript", "CSS", "Figma"],
        total_exp_mo=24,
        location="Hyderabad",
        current_employer="Tech Startup",
        source="job_board",
        resume_text="Karan Malhotra - Frontend developer with 2 years "
        "experience in React, JavaScript, CSS and Figma-based UI "
        "implementation, based in Hyderabad.",
    ),
    dict(
        full_name="Divya Krishnan",
        email="divya.krishnan@example.com",
        phone="+91-90000-00008",
        skills=["SQL", "Tableau", "Financial Analysis"],
        total_exp_mo=60,
        location="Chennai",
        current_employer="HDFC Bank",
        source="referral",
        resume_text="Divya Krishnan - Financial analyst with 5 years "
        "experience in SQL, Tableau dashboards and financial analysis "
        "for banking clients, based in Chennai.",
    ),
    dict(
        full_name="Arjun Desai",
        email="arjun.desai@example.com",
        phone="+91-90000-00009",
        skills=["DevOps", "Jenkins", "AWS", "Ansible"],
        total_exp_mo=54,
        location="Pune",
        current_employer="Capgemini",
        source="job_board",
        resume_text="Arjun Desai - DevOps engineer with 4.5 years "
        "experience in Jenkins CI/CD, AWS and Ansible automation, based "
        "in Pune.",
    ),
    dict(
        full_name="Meera Pillai",
        email="meera.pillai@example.com",
        phone="+91-90000-00010",
        skills=["Manual QA", "Test Cases", "JIRA"],
        total_exp_mo=18,
        location="Bengaluru",
        current_employer="Accenture",
        source="self_apply",
        resume_text="Meera Pillai - QA tester with 1.5 years experience "
        "writing test cases and tracking defects in JIRA, based in "
        "Bengaluru.",
    ),
    dict(
        full_name="Nikhil Joshi",
        email="nikhil.joshi@example.com",
        phone="+91-90000-00011",
        skills=["Java", "Spring Boot", "Microservices", "Kafka"],
        total_exp_mo=96,
        location="Bengaluru",
        current_employer="Larsen & Toubro Infotech",
        source="referral",
        resume_text="Nikhil Joshi - Java backend developer with 8 years "
        "experience in Spring Boot, microservices and Kafka, based in "
        "Bengaluru. Currently on an active contract placement.",
    ),
]

# (candidate_index, requisition_index, stage)
APPLICATIONS = [
    (0, 0, "screened"),   # Aarav -> Senior Python Backend Engineer
    (5, 0, "sourced"),    # Ananya -> Senior Python Backend Engineer
    (1, 1, "submitted"),  # Priya -> React Frontend Developer
    (6, 1, "sourced"),    # Karan -> React Frontend Developer
    (2, 2, "interview"),  # Rohan -> Business Analyst BFSI
    (7, 2, "sourced"),    # Divya -> Business Analyst BFSI
    (3, 3, "offer"),      # Sneha -> DevOps Engineer
    (8, 3, "sourced"),    # Arjun -> DevOps Engineer
    (4, 4, "submitted"),  # Vikram -> QA Automation Engineer
    (9, 4, "sourced"),    # Meera -> QA Automation Engineer
    (10, 5, "placed"),    # Nikhil -> Java Backend Developer (already placed)
]

# (requisition_index, recruiter_index, match_score)
ASSIGNMENTS = [
    (0, 0, 88),
    (1, 0, 75),
    (2, 1, 82),
    (3, 1, 90),
    (4, 0, 70),
    (5, 1, 85),
]


async def seed_tenant_acme(conn: asyncpg.Connection, tenant_id) -> None:
    await set_tenant(conn, tenant_id)

    admin_id = await conn.fetchval(
        """INSERT INTO users (tenant_id, email, password_hash, full_name, role)
           VALUES ($1, $2, $3, $4, 'admin') RETURNING id""",
        tenant_id, "admin@example.com", hash_password("changeme"), "Admin User",
    )
    recruiter_ids = []
    for full_name, email in [
        ("Rahul Verma", "rahul.verma@acmestaffing.in"),
        ("Sanya Kapoor", "sanya.kapoor@acmestaffing.in"),
    ]:
        rid = await conn.fetchval(
            """INSERT INTO users (tenant_id, email, password_hash, full_name, role, capacity_weekly)
               VALUES ($1, $2, $3, $4, 'recruiter', 40) RETURNING id""",
            tenant_id, email, hash_password("changeme"), full_name,
        )
        recruiter_ids.append(rid)
    await conn.execute(
        """INSERT INTO users (tenant_id, email, password_hash, full_name, role)
           VALUES ($1, $2, $3, $4, 'manager')""",
        tenant_id, "neha.joshi@acmestaffing.in", hash_password("changeme"), "Neha Joshi",
    )

    client_ids = {}
    for name, industry in CLIENTS:
        client_ids[name] = await conn.fetchval(
            "INSERT INTO clients (tenant_id, name, industry) VALUES ($1, $2, $3) RETURNING id",
            tenant_id, name, industry,
        )

    req_ids = []
    for req in REQUISITIONS:
        req_id = await conn.fetchval(
            """INSERT INTO requisitions
                 (tenant_id, client_id, title, description, skills_required,
                  location, employment_type, positions_count, sla_hours, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id""",
            tenant_id, client_ids[req["client"]], req["title"], req["description"],
            req["skills_required"], req["location"], req["employment_type"],
            req["positions_count"], req["sla_hours"], admin_id,
        )
        req_ids.append(req_id)

    cand_ids = []
    for cand in CANDIDATES:
        cand_id = await conn.fetchval(
            """INSERT INTO candidates
                 (tenant_id, full_name, email, phone, skills, total_exp_mo,
                  location, current_employer, resume_text, source)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id""",
            tenant_id, cand["full_name"], cand["email"], cand["phone"], cand["skills"],
            cand["total_exp_mo"], cand["location"], cand["current_employer"],
            cand["resume_text"], cand["source"],
        )
        cand_ids.append(cand_id)

        # HARD RULE #12: consent before any candidate PII is processed.
        await conn.execute(
            """INSERT INTO consent_records
                 (tenant_id, candidate_id, data_category, channel, consent_given, consent_text)
               VALUES ($1, $2, 'resume_processing', 'web_form', TRUE, $3)""",
            tenant_id, cand_id,
            f"{cand['full_name']} consented to resume storage and AI-based "
            "matching per DPDP 2023 at registration.",
        )

        # HARD RULE #5/#6: outbox event for downstream n8n workflows (P2).
        await conn.execute(
            """INSERT INTO event_outbox (tenant_id, event_type, payload, dedup_key)
               VALUES ($1, 'candidate.created', $2, $3)""",
            tenant_id,
            json.dumps({"candidate_id": str(cand_id), "full_name": cand["full_name"]}),
            f"candidate.created:{cand_id}",
        )

    app_ids = {}
    for cand_idx, req_idx, stage in APPLICATIONS:
        recruiter_id = recruiter_ids[req_idx % len(recruiter_ids)]
        app_id = await conn.fetchval(
            """INSERT INTO applications
                 (tenant_id, requisition_id, candidate_id, stage, assigned_recruiter_id)
               VALUES ($1, $2, $3, $4, $5) RETURNING id""",
            tenant_id, req_ids[req_idx], cand_ids[cand_idx], stage, recruiter_id,
        )
        app_ids[(cand_idx, req_idx)] = app_id

        if stage in ("submitted", "interview", "offer", "placed"):
            await conn.execute(
                """INSERT INTO submittals (tenant_id, application_id, rate_type, status)
                   VALUES ($1, $2, 'annual', $3)""",
                tenant_id, app_id,
                "shortlisted" if stage in ("interview", "offer", "placed") else "submitted",
            )

    for req_idx, recruiter_idx, match_score in ASSIGNMENTS:
        assignment_id = await conn.fetchval(
            """INSERT INTO assignments (tenant_id, requisition_id, recruiter_id, match_score)
               VALUES ($1, $2, $3, $4) RETURNING id""",
            tenant_id, req_ids[req_idx], recruiter_ids[recruiter_idx], match_score,
        )
        await conn.execute(
            """INSERT INTO assignment_event
                 (tenant_id, assignment_id, event_type, reason, actor_user_id, metadata)
               VALUES ($1, $2, 'assigned', 'initial auto-assign (seed data)', $3, $4)""",
            tenant_id, assignment_id, admin_id, json.dumps({"match_score": match_score}),
        )

    # Sneha Iyer's offer for the DevOps Engineer req — HITL gate (HARD RULE #10):
    # status starts at pending_approval, awaiting human approval before "issued".
    sneha_app_id = app_ids[(3, 3)]
    offer_id = await conn.fetchval(
        """INSERT INTO offers (tenant_id, application_id, status, ctc_offered, currency, joining_date)
           VALUES ($1, $2, 'pending_approval', 1800000, 'INR', CURRENT_DATE + INTERVAL '21 days')
           RETURNING id""",
        tenant_id, sneha_app_id,
    )
    await conn.execute(
        """INSERT INTO assignment_event
             (tenant_id, event_type, reason, actor_user_id, metadata)
           VALUES ($1, 'offer.pending_approval', 'Awaiting manager approval before issuing offer', $2, $3)""",
        tenant_id, admin_id, json.dumps({"offer_id": str(offer_id)}),
    )

    # Sneha on the hotlist (contract ending soon -> v_redeployment_queue, P1/P3)
    await conn.execute(
        """INSERT INTO hotlist (tenant_id, candidate_id, available_from, reason, notes)
           VALUES ($1, $2, CURRENT_DATE + INTERVAL '21 days', 'contract_ending',
                   'Current bench candidate, available after DevOps Engineer contract decision.')""",
        tenant_id, cand_ids[3],
    )

    # Nikhil Joshi: already-placed Java developer, contract ending in 21 days
    nikhil_app_id = app_ids[(10, 5)]
    nikhil_offer_id = await conn.fetchval(
        """INSERT INTO offers (tenant_id, application_id, status, ctc_offered, currency, joining_date, approved_by)
           VALUES ($1, $2, 'accepted', 2200000, 'INR', CURRENT_DATE - INTERVAL '60 days', $3)
           RETURNING id""",
        tenant_id, nikhil_app_id, admin_id,
    )
    await conn.execute(
        """INSERT INTO placements
             (tenant_id, offer_id, candidate_id, requisition_id, client_id,
              start_date, end_date, bill_rate, pay_rate, status)
           VALUES ($1, $2, $3, $4, $5, CURRENT_DATE - INTERVAL '60 days',
                   CURRENT_DATE + INTERVAL '21 days', 15000, 10000, 'active')""",
        tenant_id, nikhil_offer_id, cand_ids[10], req_ids[5], client_ids["Globex Manufacturing India"],
    )
    await conn.execute(
        """INSERT INTO hotlist (tenant_id, candidate_id, available_from, reason, notes)
           VALUES ($1, $2, CURRENT_DATE + INTERVAL '21 days', 'contract_ending',
                   'Java/Spring Boot contract ending — ready for redeployment.')""",
        tenant_id, cand_ids[10],
    )

    await conn.execute(
        """INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
           VALUES ($1, $2, 'seed', 'tenant', $1, $3)""",
        tenant_id, admin_id, json.dumps({"seed": "phase1_demo_data"}),
    )


async def seed_tenant_beta(conn: asyncpg.Connection, tenant_id) -> None:
    """Minimal second tenant — used to prove RLS cross-tenant isolation."""
    await set_tenant(conn, tenant_id)

    admin_id = await conn.fetchval(
        """INSERT INTO users (tenant_id, email, password_hash, full_name, role)
           VALUES ($1, $2, $3, $4, 'admin') RETURNING id""",
        tenant_id, "beta.admin@example.com", hash_password("changeme"), "Beta Admin",
    )
    client_id = await conn.fetchval(
        "INSERT INTO clients (tenant_id, name, industry) VALUES ($1, $2, $3) RETURNING id",
        tenant_id, "Beta Client Co", "Retail",
    )
    req_id = await conn.fetchval(
        """INSERT INTO requisitions
             (tenant_id, client_id, title, description, skills_required, location,
              employment_type, positions_count, sla_hours, created_by)
           VALUES ($1, $2, 'Data Analyst', 'Retail analytics data analyst role.',
                   $3, 'Delhi', 'fulltime', 1, 120, $4) RETURNING id""",
        tenant_id, client_id, ["SQL", "Python", "Tableau"], admin_id,
    )
    for full_name, email in [
        ("Test Candidate One", "test.one@example.com"),
        ("Test Candidate Two", "test.two@example.com"),
    ]:
        cand_id = await conn.fetchval(
            """INSERT INTO candidates (tenant_id, full_name, email, skills, total_exp_mo, location, resume_text)
               VALUES ($1, $2, $3, $4, 36, 'Delhi', $5) RETURNING id""",
            tenant_id, full_name, email, ["SQL", "Python"],
            f"{full_name} - Data analyst candidate with SQL and Python skills, based in Delhi.",
        )
        await conn.execute(
            """INSERT INTO consent_records (tenant_id, candidate_id, data_category, channel, consent_given, consent_text)
               VALUES ($1, $2, 'resume_processing', 'web_form', TRUE, $3)""",
            tenant_id, cand_id, f"{full_name} consented to resume processing per DPDP 2023.",
        )
    await conn.execute(
        """INSERT INTO applications (tenant_id, requisition_id, candidate_id, stage)
           SELECT $1, $2, id, 'sourced' FROM candidates WHERE tenant_id = $1""",
        tenant_id, req_id,
    )


async def main() -> None:
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    async with pool.acquire() as conn:
        acme_id, acme_existed = await get_or_create_tenant(conn, "Acme Staffing India", "acme")
        beta_id, beta_existed = await get_or_create_tenant(conn, "Beta Tech Staffing", "beta")

        if not await already_seeded(conn, acme_id):
            async with conn.transaction():
                await seed_tenant_acme(conn, acme_id)
            print(f"Seeded tenant 'acme': {acme_id}")
        else:
            print(f"Tenant 'acme' already seeded: {acme_id}")

        if not await already_seeded(conn, beta_id):
            async with conn.transaction():
                await seed_tenant_beta(conn, beta_id)
            print(f"Seeded tenant 'beta': {beta_id}")
        else:
            print(f"Tenant 'beta' already seeded: {beta_id}")

    print(f"TENANT_ID={acme_id}")
    await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
