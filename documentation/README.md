# ISMS Documentation

The documentation set for KayKay's Integrated Shop Management System (ISMS), release 1.0.1.

## Documents

| ID | Document | For | Folder (each holds .md, .docx and .pdf) |
|---|---|---|---|
| ISMS-UG | System User Guide | Staff: owners, managers, cashiers, riders, suppliers | `final/ISMS-System-User-Guide/` |
| ISMS-TD | Technical Documentation | Developers and technical staff | `final/ISMS-Technical-Documentation/` |
| ISMS-AG | System Administration Guide | Business administrators and the platform operator | `final/ISMS-System-Administration-Guide/` |

The Markdown file is the master source; the Word (.docx) and PDF files are generated from it, in the app's colours (amber on slate).

Document owner: Dennis Kimanthi Gitonga, Codensons (kimanthidennis02@gmail.com; company: codensons@gmail.com).

## Folders

| Folder | Holds |
|---|---|
| `final/` | The three documents in three formats each, their screenshots (`images/screens/`) and diagrams (`diagrams/`, sources in `diagrams/src/`) |
| `audit/` | Inventory and audit, migration map, verification and QA report, open gaps (records of the restructuring; the old files they name were removed on 24 November 2026 and remain in git history) |
| `tools/` | Build tools; `build_docs.py` builds this set |

## Building

Needs Python 3 with `markdown` and `pypdf`, Pillow, Graphviz, Google Chrome, Node.js 22 and LibreOffice (with its Python `uno` module).

```bash
python3 documentation/tools/build_docs.py all            # diagrams, checks, PDF and DOCX for all three
python3 documentation/tools/build_docs.py ug --check     # checks only for one document (ug, td, ag)
```

The build refuses to produce output if headings, figure or table numbering, captions, images or internal links are wrong.

## Writing conventions

- Chapters: `# Chapter N: Title`; parts: `# Part I: Title`; appendices: `# Appendix A: Title`.
- Sections `## N.M Title`, subsections `### N.M.K Title`.
- Every table in a chapter has a caption line `**Table N.M:** Title` directly before it.
- Figures: `![Figure N.M: Title](images/screens/name.jpg)` alone in a paragraph.
- Cross-references are links: `[Section 9.2](#s-9-2)`, `[Table 9.1](#t-9-1)`, `[Figure 8.1](#f-8-1)`, `[Chapter 12](#ch-12)`.
- Callouts: `> **Note:**`, `> **Important:**`, `> **Warning:**`.
- Screen names exactly as in `src/utils/screens.ts`. Update the version history and dates in the front matter with every change.

## Other documents kept in the repository

Only working records that the three documents link to stay outside this folder: `docs/TO_FINISH.md`, `docs/BACKUP_AND_RECOVERY.md` (restore drill log), `docs/HOSTING_CLOUDFLARE.md` (domain move), `docs/GOING_PRIVATE.md`, `docs/deployment/release-safety.md`, `docs/security/threat-register.md`, `docs/infrastructure/cost-management.md`, `docs/operations/` (owner setup, accounts), `docs/roadmap/`, `supabase/SEED_LOGINS.md`, plus `README.md`, `TERMS.md` (shown in the app), `LICENSE` and `CLAUDE.md`.
