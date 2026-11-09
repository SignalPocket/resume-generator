# Generate application packages from your phone

Use your own Notion page as the source and destination. The private GitHub runner downloads reviewed Markdown and Word references, creates the resume and cover letter in Word, converts those Word files to matching PDFs, and attaches all four files back to that page. Your home computer can be off after setup.

This is an on-demand formatter, not a job-application bot. It does not write claims, search jobs, submit applications or change a tracker status. An AI assistant can help prepare the sources through your connected apps, but no AI subscription or model key is required by the generator itself.

## What you need

| Component | Purpose |
| --- | --- |
| Your own private GitHub repository with this code | Runs conversion away from your computer |
| GitHub Actions enabled and available runner minutes | Executes the workflow; check your account's usage limits |
| A Notion workspace and an application page | Stores the six inputs and four finished documents |
| Your own Notion internal connection | Lets the runner read and attach files |
| Reviewed resume and letter Markdown plus reference Word designs | Supplies your exact wording and formatting |
| Optional assistant with Notion and GitHub connections | Prepares and triggers requests from phone chat |

No particular Notion database, property names, applicant identity or resume wording is required. An ordinary page works.

## 1 Create your private working copy

Download the [source ZIP](https://github.com/SignalPocket/resume-generator/archive/refs/heads/main.zip), unzip it, create a new **private** repository on GitHub, and upload the contents of the extracted folder, including `.github/workflows`. Put the files at the repository root. Use `main` as the default branch for the push trigger.

Alternatively clone the public code, then push that clean source to a new empty private repository:

```bash
git clone https://github.com/SignalPocket/resume-generator.git my-resume-generator
cd my-resume-generator
git remote rename origin upstream
git remote add origin https://github.com/YOUR-ACCOUNT/YOUR-PRIVATE-REPO.git
git push -u origin main
```

Replace the uppercase placeholders. No applicant files belong in the repository. You can fork the public project to contribute code or use it locally, but a public fork is not the private working copy required for cloud packages. [GitHub explains fork visibility](https://docs.github.com/en/pull-requests/reference/forks).

The cloud workflow explicitly fails in a public repository before checkout or accessing the Notion token. Do not remove that guard to run personal packages publicly.

## 2 Give your runner limited Notion access

1. Create your own [Notion internal connection](https://www.notion.so/profile/integrations). Give it **Read content**, **Insert content** and **Update content** capabilities.
2. In Notion, open the page or parent application area you want the runner to use. From its menu, add your connection under **Connections**. Limit access to the pages it needs. The runner also needs access to every referenced input file block.
3. In your private repository, open **Settings → Secrets and variables → Actions → New repository secret**. Set the name to `NOTION_TOKEN` and the value to your connection's secret.
4. Enable GitHub Actions if your copy requires it. The workflow needs only repository **Contents: read**; GitHub's token does not upload to Notion.

Never paste that token into a Notion page, chat, request JSON, source file or commit. A chat assistant's Notion connection is separate from the runner's internal connection. Connecting one does not configure the other.

Official references: [Notion connection capabilities](https://developers.notion.com/reference/capabilities), [file upload guide](https://developers.notion.com/docs/uploading-small-files), and [GitHub Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions).

## 3 Prepare your own references and sources

Do this once for each design, then reuse the approved sources or create a new version page when wording changes. Install Node.js 22+, Python 3.12+ and the Python requirements on the setup machine. LibreOffice is needed for local PDF previews, but the runner installs its own converter.

```bash
python -m pip install -r requirements.txt
node src/cli.mjs import /path/to/your-resume.docx --out applications/resume
node src/cli.mjs import /path/to/your-letter.docx --type cover-letter --out applications/letter
```

Each import creates Markdown, `template.json` and an unchanged `reference.docx`. Review the Markdown for exact facts, dates, contact details and working links before using it. The reference supplies formatting, not hidden application prose. Adjust the template's `maxPages` to your reviewed page target. The generator never shrinks or deletes text to force a fit.

The importer supports clean, single-column text documents, not arbitrary Word layouts. Unsupported tables, fields, revisions, comments, drawings or ambiguous structures produce an error. Resume names can use Heading 1 with sections/roles/employers in Heading 2/3/4. Imported cover letters retain paragraph slots: adding or removing paragraphs requires a compatible new reference. Build and inspect a preview whenever you change the design:

```bash
node src/cli.mjs build applications/resume/resume.md --template applications/resume/template.json --application preview-resume
node src/cli.mjs build applications/letter/cover-letter.md --type cover-letter --template applications/letter/template.json --application preview-letter
```

For a design created from the generic templates, first build Word locally with `--docx-only`, review it, then import that Word file as your reference. The Notion package workflow requires references for both documents so later builds keep the reviewed designs.

## 4 Attach a reviewed package to Notion

Create a new application/version page and copy its page UUID from its URL. A database or saved-view ID is not an application page ID. Your connection must have access to the page.

Set `NOTION_TOKEN` securely in your local environment for this setup command (for example through your shell's secret manager). Do not place its literal value in the command or a script. Upload the exact reviewed inputs:

```bash
node src/prepare-notion.mjs --page YOUR-PAGE-UUID --resume applications/resume/resume.md --resume-template applications/resume/template.json --letter applications/letter/cover-letter.md --letter-template applications/letter/template.json --approve-sources
```

`--approve-sources` records that you reviewed these exact files. The command checks local inputs, uploads six files, obtains the real Notion block IDs, computes SHA-256 values and adds a dated request. It refuses to append a second request to the same page. It does **not** run conversion or submit anything to an employer.

For changes, create a fresh version page or deliberately replace the existing request with the new exact sources/checksums. Keep earlier versions if you need an audit trail. If a connection drops during a write, inspect the page before retrying; the command will not blindly repeat an ambiguous append.

### Preparing entirely through an assistant on your phone

After the connections and references are set up, an assistant with working Notion file uploads and GitHub file writes can perform step 4 without the setup machine. Tell it which application page and private repository to use, which sources/designs are approved, and whether it may change the wording. It must upload six dedicated source files, read back their **block IDs**, compute the exact checksums and add the request described below. It should not convert internal review notes or a whole Notion page into application prose.

This repository includes [assistant instructions](docs/PHONE_ASSISTANT.md) you can supply to your assistant. They contain no personal defaults. ChatGPT Work can perform the workflow with suitable connected-app permissions; availability in other assistants depends on their actual file-upload and GitHub capabilities. There is no public hosted endpoint or automatic polling service.

## 5 Generate from your phone

On GitHub in your private working repository, open **Actions → Generate Notion application package → Run workflow**, choose the default branch and enter the Notion page UUID. Wait for the run to complete, then return to the Notion page.

Alternatively, ask a connected assistant to create or update `requests/generate.json` on `main`:

```json
{"notionPageId":"11111111-1111-4111-8111-111111111111","requestId":"example-role-v1"}
```

Replace the fictional UUID and give each new trigger a unique requestId. A push to that path triggers generation. Only a page pointer enters GitHub; the source wording, references, token and generated files remain out of Git history. Page IDs are still metadata, which is another reason to use a private copy.

Suggested phone request:

> Generate the reviewed resume and cover letter for this Notion page using my private generator repository, attach Word and PDF versions of both, check the returned files, and send me the Notion link. Do not submit an application.

## 6 Open the results

The page receives **Generated documents - visual review required** with two Word attachments and two PDFs. A request-hash marker identifies the exact source version. Re-running the unchanged request returns `already-attached` without adding duplicate output attachments. The checked marker protects serial retries; do not run concurrent local generators for the same page.

Open the PDFs on your phone to read the finished documents. The `.md`, `.json` and reference `.docx` attachments are generator inputs. You do not need a Markdown reader to read the final package.

The runner verifies checksums, full output text, page counts and successful Word-to-PDF conversion before attaching a complete package. You or your assistant must still inspect every actual page for wrapping, bullets, links, spacing and clipping. The Linux runner uses Liberation/Carlito substitutes for Arial/Calibri; layout can differ from Windows fonts. It does not promise pixel-identical rendering on every computer.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Workflow fails at the privacy step | Use a private independent working repository |
| No workflow after a push | Is the file exactly `requests/generate.json` on `main`? Is Actions enabled? Try manual Run workflow |
| Notion request fails | Check your own NOTION_TOKEN, connection capabilities, page sharing and referenced-file access |
| Expected one request | Keep one current request code block; remove neither history nor files blindly |
| Source changed after approval | Review the new version and prepare a new request with new checksums |
| Generation fails without private content in logs | Run the ordinary CLI against your own sources locally and inspect its error; fix the source/reference or renderer |
| Build exceeds page target | Edit/reflow the content or deliberately approve a different target; no automatic shrinking occurs |
| No partial outputs after one document fails | Expected: both documents must pass before any of the four results are attached |
| Uncertain attachment result | Inspect the page and request marker before retrying |

## Request protocol for integrations

Add one JSON code block captioned `ResumeGenerator request v1`. A Markdown connector unable to set captions may create one uncaptioned JSON block matching this schema instead. The runner rejects ambiguous requests. All UUIDs and hashes below are fictional; replace all of them with real saved **block IDs** and exact source-byte hashes.

```json
{
  "schemaVersion": 1,
  "approval": {"approved": true, "approvedAt": "2026-11-09T12:00:00Z"},
  "documents": [
    {
      "type": "resume",
      "source": {"blockId": "11111111-1111-4111-8111-111111111111", "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
      "profile": {"blockId": "22222222-2222-4222-8222-222222222222", "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
      "reference": {"blockId": "33333333-3333-4333-8333-333333333333", "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
    },
    {
      "type": "cover-letter",
      "source": {"blockId": "44444444-4444-4444-8444-444444444444", "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"},
      "profile": {"blockId": "55555555-5555-4555-8555-555555555555", "sha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"},
      "reference": {"blockId": "66666666-6666-4666-8666-666666666666", "sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}
    }
  ]
}
```

Files must be uploaded Notion-managed file/PDF blocks, at most 20 MiB each. External links are rejected. The runner rechecks the request before attachment and cleans its temporary workspace afterward. No personal output becomes an Actions artifact. Treat anyone with edit access to the Notion request as able to alter the sources/approval: the flag records workflow intent, not a cryptographic human signature. Restrict page and repository access appropriately.

For a local run, set `NOTION_TOKEN` and `NOTION_PAGE_ID` securely in the environment, then run `node src/notion-package.mjs`.
