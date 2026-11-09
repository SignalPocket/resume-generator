# ResumeGenerator

Turn Markdown of resumes and cover letters into Word and PDF formats. Formatting lives in reusable templates. **python-docx generates Word, then headless LibreOffice converts that file to PDF**. Microsoft Word is not required. No AI calls or npm dependencies.

## Get your own copy

- **[Download ZIP](https://github.com/SignalPocket/resume-generator/archive/refs/heads/main.zip)** to run locally.
- **[Fork the code](https://github.com/SignalPocket/resume-generator/fork)** to contribute changes or keep a public code copy.
- **For phone-to-Notion generation**, copy the clean source into your own **private** repository and follow [the setup guide](NOTION_WORKFLOW.md). Public forks cannot run personal package generation.

The public source contains fictional examples only. Bring your own resume, cover letter, templates, Notion pages and connection. No applicant data or credentials are bundled.

## Generate from your phone

Once configured, ask a connected assistant to prepare your reviewed package and trigger the private runner, or start it from GitHub Actions on your phone. The runner reads your exact sources from Notion and attaches **resume.docx, resume.pdf, cover-letter.docx and cover-letter.pdf** back to the application page. Your computer can be off. It checks source hashes, complete output text and page targets, and avoids duplicate attachments on serial retries. It never submits a job application.

Read **[setup, permissions, phone instructions and troubleshooting](NOTION_WORKFLOW.md)**. Optional [assistant instructions](docs/PHONE_ASSISTANT.md) explain the connected-app handoff. There is no hosted public service, built-in AI writer or universal chat-app integration.

## Quick start

Requires Node.js 22 or newer, Python 3.12 or newer, and LibreOffice Writer for PDF export. Install the Python packages once:

```powershell
python -m pip install -r requirements.txt
```

The CLI uses `python` on Windows or `python3` elsewhere, falling back to `py -3` or `python` respectively when the first command does not exist. Set `RESUME_PYTHON` to the full interpreter path to select a virtual environment. Set `RESUME_SOFFICE` to the full LibreOffice executable path if it is not on PATH. These variables select tools; they do not install anything or change system permissions.

From this folder:

```powershell
node src/cli.mjs check examples/resume.md
node src/cli.mjs build examples/resume.md --application sample
node src/cli.mjs build examples/cover-letter.md --type cover-letter --application sample-letter
```

Run `npm test` for automated checks. The sample is fictional; replace it with reviewed content before using a resume.

For an application, save your content in `applications/company-role.md` and run:

```powershell
node src/cli.mjs build applications/company-role.md --application company-role
```

Use `--docx-only` to generate Word without PDF conversion. Use `--out directory` to select an output root, or `--template path/to/template.json` to choose another style.

## Import an approved reference resume

```powershell
node src/cli.mjs import path/to/approved.docx --out applications/company-reference
node src/cli.mjs build applications/company-reference/resume.md --template applications/company-reference/template.json --application company-roundtrip
```

The importer makes a Markdown copy, a template profile and an unchanged `reference.docx`. The original stays untouched. Imported formatting uses the reference's paragraph components, numbering, styles, theme, settings and page geometry. Those package parts are retained byte-for-byte. All visible body text comes from Markdown, including bold lead-ins and clickable links. Nonbreaking hyphens remain visible Unicode in Markdown and are restored as Word nonbreaking-hyphen elements.

This reference importer supports a clean single-section, single-column resume: a combined or separate name/contact block (the name may use Heading 1), paragraphs, Heading 2 sections, Heading 3 roles, Heading 4 employer/date lines, and bullets. It rejects tables, comments, revisions, fields, drawings, controls, blank body paragraphs, unequal margins, or ambiguous inline syntax for manual review. It does not claim to import arbitrary Word layouts. `####` represents the separate employer/date line in imported Markdown.

Reference builds save the reference and its checksum alongside each version. Changing a generic numeric template setting does not restyle a reference build: reference formatting controls that mode. Adjust the reference components intentionally when changing its design.

## Markdown format

```markdown
# Candidate Name

Target role

Location | email@example.com | [Portfolio](https://example.com)

## Summary

A reviewed summary supported by your experience.

## Experience

### Role | Employer | Dates

- An accomplishment with **selective emphasis**.
- Another supported accomplishment.

## Education

Degree | University
```

Use one `#` candidate name, `##` sections, `###` role headings, paragraphs, `-` or `*` bullets, `**bold**` and `[label](https://url)` links. Blank lines separate paragraphs. Wrapped lines become a single paragraph. Put `<!-- pagebreak -->` on a line by itself for a deliberate page break.

Unsupported structures, including nested lists, tables, HTML, images and code, produce an error rather than silently dropping content. Contact information stays in the body. Headings and list numbering use real Word semantics. Text uses one column without layout tables or text boxes.

## Cover Letters

```powershell
node src/cli.mjs check examples/cover-letter.md --type cover-letter
node src/cli.mjs build examples/cover-letter.md --type cover-letter --application example-letter
node src/cli.mjs import path/to/approved-letter.docx --type cover-letter --out applications/letter-reference
node src/cli.mjs build applications/letter-reference/cover-letter.md --template applications/letter-reference/template.json --application letter-roundtrip
```

Cover letters use ordinary paragraphs, optional name headings, bold emphasis and links. A trailing pair of spaces or backslash creates a hard line break for recipient and sign-off lines. `<!-- blank -->` preserves an intentionally blank reference paragraph. A letter does not need resume sections. The default letter template uses 11 pt Arial, one-inch margins, 1.15 line spacing, left alignment and a one-page target. Imported references retain their approved formatting instead.

Letter versions contain `cover-letter.docx`, `cover-letter.pdf`, `cover-letter.txt`, `source.md`, `template.json`, and `manifest.json`. Imported versions also save `reference.docx`. Reference letters preserve paragraph slots; use the generic letter template when adding or removing paragraphs. The tool formats already-reviewed content; it does not write or submit an application.

## Formatting and versions

`templates/default.json` controls Calibri typography, US Letter margins and spacing. No automatic shrinking or content deletion is used to meet the page target. Review long resumes and add a deliberate page break when needed.

Every successful build creates a new `outputs/company-role/v001`, `v002`, etc. Each contains `resume.docx`, `resume.pdf` (unless DOCX-only), the original `source.md`, `template.json`, readable `resume.txt`, and a `manifest.json` recording hashes, timestamp, generator version, renderer, page count and warnings.

Builds never overwrite saved versions. PDF export runs LibreOffice headlessly with a separate temporary profile, then checks the PDF using pypdf. Export failures remove partial output. A resume exceeding the template page target is saved with a warning; a DOCX-only build explicitly reports that pagination is unchecked. Install the requested font or a metrically compatible substitute on the rendering machine to control line wrapping. The Linux build installs Liberation fonts as an Arial substitute.

Application names allow letters, numbers, hyphens and underscores, must start with a letter or number, and cannot be reserved Windows device names. `applications/`, `outputs/`, local environment files, Word documents, PDFs and ZIP files are ignored by Git. Keep personal content in those local directories. Gitignore does not remove anything already committed; never publish an existing private history without reviewing every branch and build artifact.

The public examples are fictional. Run `node scripts/check-public-package.mjs` before publishing a source snapshot. The public CI also checks the source package; personal generation uses a separate workflow without document artifacts. It checks tracked file paths and non-example email addresses; it does not replace a review of history, hidden document metadata, repository settings or account association.

## Validation status

Automated tests cover Markdown preservation, invalid input, python-docx output structure, concurrent version creation, source preservation, PDF failure cleanup and page-limit warnings. The included sample can be built with `--docx-only` without LibreOffice.

GitHub Actions also installs the same headless publishing tools used by Greenhouse, builds the fictional sample into Word and PDF, checks text reading order, hyperlinks and pagination, renders page images, and saves the `sample-word-pdf` artifact for review. It does not publish a website. Only the committed fictional sample is built there; local application sources and outputs stay ignored by Git. Review the rendered pages before using a new template or application version.

The publishing approach follows an existing docs-as-code portfolio workflow, adapted to application documents. Fictional resume and cover-letter examples and reference round-trip checks are included.

## Source profiles and limits

Save `resume.template.json` beside `resume.md` (or `cover-letter.template.json` beside `cover-letter.md`) to select a design automatically. An explicit `--template` overrides the sidecar. Invalid profiles fail rather than falling back silently. Reference paths resolve relative to their profile.

This is a formatter with a small Markdown dialect, not a graphical editor or a job-posting analyzer. The optional Notion workflow uploads sources and attaches generated documents; it does not tailor claims or submit applications. Review wording, rights to any samples and actual final pages before use. Font substitution can change pagination between computers.

## Tests

```bash
npm test
npm run check:public
node scripts/verify-notion-roundtrip.mjs
```

The last command requires LibreOffice and exercises the complete preparation/conversion/attachment path with fictional files and an in-memory Notion service. It needs no token, makes no network calls and does not establish that your own Notion connection is configured. CI runs it on Linux, alongside reference round-trip checks and Windows/Linux unit tests. Test a fictional page in your own private setup before processing real applications.

## License

[MIT](LICENSE). You may download, use, modify and redistribute the code under that license. Runtime dependencies retain their own licenses.
