import os
import re
import shutil
import subprocess
import tempfile
from typing import Any, Dict, List, Optional, Tuple

from jinja2 import Template


def _escape_latex(text: str) -> str:
    if text is None:
        return ""
    replacements = {
        "\\": r"\textbackslash{}",
        "{": r"\{",
        "}": r"\}",
        "#": r"\#",
        "%": r"\%",
        "&": r"\&",
        "_": r"\_",
        "^": r"\textasciicircum{}",
        "~": r"\textasciitilde{}",
        "$": r"\$",
    }
    return "".join(replacements.get(c, c) for c in text)


def _normalize_font(font: Optional[str]) -> str:
    if not font:
        return "lmodern"
    f = font.strip().lower()
    if any(k in f for k in ["times", "newtx", "tx"]):
        return "newtx"
    if any(k in f for k in ["palatino", "pazo"]):
        return "palatino"
    if any(k in f for k in ["libertine"]):
        return "libertine"
    return "lmodern"


def _ensure_tectonic_available() -> str:
    exe = shutil.which("tectonic")
    if not exe:
        raise RuntimeError("tectonic binary not found in PATH")
    return exe


def _download_s3_to_path(s3_client: Any, bucket: str, storage_key: str, dst_path: str) -> None:
    resp = s3_client.get_object(Bucket=bucket, Key=storage_key)
    body = resp["Body"].read()
    with open(dst_path, "wb") as f:
        f.write(body)


def _find_artifact_for_section(section: Dict[str, Any], artifacts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    artifact_ref = section.get("artifact")
    if not artifact_ref:
        return None

    if isinstance(artifact_ref, dict):
        st = artifact_ref.get("type")
        role = artifact_ref.get("role")
        for a in artifacts:
            if a.get("type") == st and a.get("role") == role:
                return a
        for a in artifacts:
            if a.get("type") == st:
                return a
        return None

    if isinstance(artifact_ref, str):
        ref = artifact_ref.strip()
        m = re.match(r"^(?P<type>[^:]+):(?P<role>.+)$", ref)
        if m:
            st = m.group("type")
            role = m.group("role")
            for a in artifacts:
                if a.get("type") == st and a.get("role") == role:
                    return a
        for a in artifacts:
            if a.get("role") == ref:
                return a
        for a in artifacts:
            if a.get("type") == ref:
                return a

    return None


LATEX_TEMPLATE = r"""
\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{graphicx}
\usepackage{hyperref}
\usepackage{xcolor}
\usepackage{booktabs}
\usepackage{array}
\usepackage{microtype}
\usepackage{setspace}
\usepackage{enumitem}
\usepackage{float}
\usepackage{caption}
\usepackage{tikz}
\usepackage{eso-pic}

{% if font == 'newtx' %}
\usepackage{newtxtext}
\usepackage{newtxmath}
{% elif font == 'palatino' %}
\usepackage{mathpazo}
{% elif font == 'libertine' %}
\usepackage{libertine}
{% else %}
\usepackage{lmodern}
{% endif %}

\hypersetup{
  colorlinks=true,
  linkcolor=blue,
  urlcolor=blue,
  citecolor=blue
}

{% if page_border %}
\AddToShipoutPictureBG{
  \begin{tikzpicture}[remember picture,overlay]
    \draw[line width={{ border_width }}, color={{ border_color }}]
      ([xshift={{ border_inset }},yshift=-{{ border_inset }}]current page.north west)
      rectangle
      ([xshift=-{{ border_inset }},yshift={{ border_inset }}]current page.south east);
  \end{tikzpicture}
}
{% endif %}

\title{\textbf{ {{ title }} }}
\author{ {{ author }} }
\date{ {{ date }} }

\begin{document}
\maketitle

\onehalfspacing

{% if abstract %}
\begin{abstract}
{{ abstract }}
\end{abstract}
{% endif %}

{% for s in sections %}
\section*{ {{ s.heading }} }

{% if s.kind == 'text' %}
{{ s.content }}
{% elif s.kind == 'image' %}
\begin{figure}[H]
  \centering
  \includegraphics[width=0.95\linewidth]{ {{ s.image_path }} }
  {% if s.caption %}\caption{ {{ s.caption }} }{% endif %}
\end{figure}
{% endif %}

{% endfor %}

\end{document}
"""


def generate_pdf_from_payload(
    payload: Dict[str, Any],
    all_job_artifacts: List[Dict[str, Any]],
    s3_client: Any,
    s3_bucket: str,
) -> Tuple[bytes, Dict[str, Any]]:
    tectonic_exe = _ensure_tectonic_available()

    title = _escape_latex(payload.get("title", "Generated Report"))
    style = payload.get("style", {}) if isinstance(payload.get("style"), dict) else {}

    user_instructions = payload.get("instructions") or payload.get("formatting")
    if isinstance(user_instructions, str) and user_instructions.strip():
        style = {**style, "instructions": user_instructions.strip()}

    font = _normalize_font(style.get("font"))

    page_border = bool(style.get("page_border"))
    border_color = style.get("border_color", "black")
    border_width = style.get("border_width", "0.8pt")
    border_inset = style.get("border_inset", "18pt")

    author = _escape_latex(style.get("author", ""))
    date = _escape_latex(style.get("date", ""))
    abstract = style.get("abstract")
    abstract = _escape_latex(abstract) if isinstance(abstract, str) else ""

    sections_in = payload.get("sections", [])
    if not isinstance(sections_in, list) or len(sections_in) == 0:
        raise ValueError("Designer payload must contain at least one section")

    embedded_artifacts = 0

    with tempfile.TemporaryDirectory(prefix="latex_report_") as tmpdir:
        assets_dir = os.path.join(tmpdir, "assets")
        os.makedirs(assets_dir, exist_ok=True)

        rendered_sections: List[Dict[str, Any]] = []

        for idx, section in enumerate(sections_in):
            if not isinstance(section, dict):
                continue

            heading = _escape_latex(str(section.get("heading", f"Section {idx + 1}")))

            artifact = _find_artifact_for_section(section, all_job_artifacts)
            if artifact and artifact.get("storage_key"):
                storage_key = artifact.get("storage_key")
                ext = os.path.splitext(artifact.get("filename") or "")[1].lower() or ".png"
                local_name = f"artifact_{idx}{ext}"
                local_path = os.path.join(assets_dir, local_name)
                _download_s3_to_path(s3_client, s3_bucket, storage_key, local_path)

                rendered_sections.append(
                    {
                        "heading": heading,
                        "kind": "image",
                        "image_path": f"assets/{local_name}",
                        "caption": _escape_latex(str(section.get("caption", ""))) if section.get("caption") else "",
                    }
                )
                embedded_artifacts += 1
                continue

            content = section.get("content", "")
            content = _escape_latex(str(content))
            rendered_sections.append({"heading": heading, "kind": "text", "content": content})

        tpl = Template(LATEX_TEMPLATE)
        tex = tpl.render(
            title=title,
            author=author,
            date=date,
            abstract=abstract,
            sections=rendered_sections,
            font=font,
            page_border=page_border,
            border_color=border_color,
            border_width=border_width,
            border_inset=border_inset,
            style=style,
        )

        tex_path = os.path.join(tmpdir, "main.tex")
        with open(tex_path, "w", encoding="utf-8") as f:
            f.write(tex)

        cmd = [
            tectonic_exe,
            "--synctex",
            "--keep-logs",
            "--keep-intermediates",
            "--outdir",
            tmpdir,
            tex_path,
        ]

        proc = subprocess.run(
            cmd,
            cwd=tmpdir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
            text=True,
        )

        pdf_path = os.path.join(tmpdir, "main.pdf")
        if proc.returncode != 0 or not os.path.exists(pdf_path):
            out = proc.stdout[-8000:] if proc.stdout else ""
            raise RuntimeError(f"Tectonic failed (code={proc.returncode}). Output:\n{out}")

        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        metadata = {
            "embedded_artifacts": embedded_artifacts,
            "section_count": len(rendered_sections),
            "font": font,
            "page_border": page_border,
        }

        return pdf_bytes, metadata
