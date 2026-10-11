%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Single-page resume class
%
% Build with: tectonic resume/resume.tex --outdir ./public
%
% Layout knobs are grouped at the top of this file. If the resume spills onto a
% second page, tighten \bulletsep / \rolesep / \sectionsep before touching the
% font size or margins.
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

\ProvidesClass{resume}[2026/10/11 Single-page resume]

\LoadClass[10pt,letterpaper]{article}

%----------------------------------------------------------------------------------------
%	LAYOUT KNOBS
%----------------------------------------------------------------------------------------

\RequirePackage[letterpaper,left=0.55in,right=0.55in,top=0.45in,bottom=0.4in]{geometry}

\newlength{\sectionsep} \setlength{\sectionsep}{9pt}   % Space above each section heading
\newlength{\rolesep}    \setlength{\rolesep}{7pt}      % Space above each role
\newlength{\bulletsep}  \setlength{\bulletsep}{1.5pt}  % Space between bullets

%----------------------------------------------------------------------------------------
%	PACKAGES
%----------------------------------------------------------------------------------------

% XCharter is compact and, unlike some of the sans options in the TeX bundle, keeps
% word spaces and plain hyphens when resume parsers extract text from the PDF.
\RequirePackage{fontspec}
\setmainfont{XCharter}[
  Extension=.otf,
  UprightFont=*-Roman,
  BoldFont=*-Bold,
  ItalicFont=*-Italic,
  BoldItalicFont=*-BoldItalic,
  Numbers={Lining,Proportional},
]
\RequirePackage{enumitem}
\RequirePackage[hidelinks]{hyperref}

\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{0pt}
\linespread{1.04}
\emergencystretch=2em
\hyphenpenalty=10000 % Never hyphenate; a resume reads better with whole words
\exhyphenpenalty=2000 % Discourage breaking at explicit hyphens (e.g. "run-time")
\urlstyle{same}
\frenchspacing % Single space after periods

%----------------------------------------------------------------------------------------
%	HEADER
%----------------------------------------------------------------------------------------

% \resumeheader{name}{contact line}
\newcommand{\resumeheader}[2]{%
  \begingroup
    \centering
    {\fontsize{23}{26}\selectfont\bfseries #1\par}%
    \vspace{4pt}%
    {\small #2\par}%
  \endgroup
}

% Separator between items on the contact line
\newcommand{\sep}{\hspace{0.6em}\textperiodcentered\hspace{0.6em}}

%----------------------------------------------------------------------------------------
%	SECTIONS
%----------------------------------------------------------------------------------------

% \resumesection{title}
\newcommand{\resumesection}[1]{%
  \par\vspace{\sectionsep}%
  {\small\bfseries\addfontfeature{LetterSpace=7.0}\MakeUppercase{#1}\par}%
  \vspace{2pt}\hrule height 0.5pt\vspace{1pt}%
}

%----------------------------------------------------------------------------------------
%	ROLES
%----------------------------------------------------------------------------------------

% \begin{role}{company}{title}{dates} \item ... \end{role}
\newenvironment{role}[3]{%
  \par\vspace{\rolesep}%
  {\bfseries #1}\hspace{0.7em}{\itshape #2}\hfill{#3}\par
  \begin{itemize}[leftmargin=1.05em,labelsep=0.45em,itemsep=\bulletsep,topsep=2.5pt,parsep=0pt,partopsep=0pt,label={\raisebox{0.15ex}{\footnotesize\textbullet}}]
}{%
  \end{itemize}
}

% Bold lead-in for a bullet that opens a new area of work within a role
\newcommand{\lead}[1]{\textbf{#1.}}

% \entry{label}{text}: a hanging one-liner for sections without bullets (education, skills)
\newcommand{\entry}[2]{\par\vspace{3.5pt}\textbf{#1}\hspace{0.7em}#2\par}
\newcommand{\subentry}[1]{\par\vspace{1.5pt}#1\par}
