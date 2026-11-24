#!/usr/bin/env python3
"""Build ISMS-CLF (Commercialisation, Licensing and Financial Model) with build_docs.py,
without changing the three-document set that build_docs.py builds by default.

    python3 documentation/tools/build_clf.py            # checks, PDF and DOCX
    python3 documentation/tools/build_clf.py --check    # checks only
"""
import sys
import build_docs

build_docs.DOCS_SET["clf"] = ("ISMS-Commercialisation-Licensing-and-Financial-Model",
                              "ISMS_COMMERCIALISATION_LICENSING_AND_FINANCIAL_MODEL")
sys.argv = [sys.argv[0], "clf", *sys.argv[1:]]
build_docs.main()
