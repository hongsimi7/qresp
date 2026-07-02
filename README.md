[![Build Status](https://travis-ci.org/qresp-code-development/qresp.svg?branch=master)](https://travis-ci.org/qresp-code-development/qresp)
# Qresp
Official [Qresp](http://qresp.org) software repository. 

## About
**Qresp** "Curation and Exploration of Reproducible Scientific Papers" is a Python application that facilitates the organization, annotation and exploration of data presented in scientific papers.

Reference: 

M. Govoni, M. Munakami, A. Tanikanti, J. H. Skone, H. B. Runesha, F. Giberti, J. de Pablo, and G. Galli, *Qresp, a tool for curating, discovering and exploring reproducible scientific papers*, Sci. Data 6, 190002 (2019). [https://doi.org/10.1038/sdata.2019.2](https://doi.org/10.1038/sdata.2019.2).

## Documentation
**Qresp** documentation is available at [qresp.org](http://qresp.org).

## Development 
The **Qresp** development is hosted on [GitHub](https://github.com/west-code-development/qresp), and licensed under the open-source GPLv3 license. See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), and [AUTHORS.md](AUTHORS.md) for more information.

## Local development setup

### Recommended runtime versions
| Component | Recommended | Notes |
| --- | --- | --- |
| Python (backend) | **3.10** | Legacy Flask stack validated on 3.8–3.10. |
| Python (`prototypes/curation_assistant`) | **3.11** | Standalone, fully tested. |
| Node.js (frontend) | **14** | Required by the current Next.js 9 build (see modernization notes). |
| MongoDB | **6.0** | The repo's compose file still references the EOL 3.6 image. |

See [`modernization_report.md`](modernization_report.md) for the dependency
audit, applied upgrades, compatibility risks, and recommended future upgrades.

### Backend (Flask API)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python setup.py install
# tests require a running MongoDB instance:
nose2 --with-coverage -v
```
> The dependency upper bounds in `requirements.txt` are required by the current
> source (WTForms < 3, connexion < 3, Flask < 2.3). Do not lift them without the
> code migration described in the modernization report.

### Frontend (Next.js)
```bash
cd frontend
yarn install      # or: npm install
yarn dev          # http://localhost:3000
yarn test         # jest
```

### Curation assistant prototype
```bash
cd prototypes/curation_assistant
python -m pip install -e ".[pdf,schema,test]"
python -m pytest
```

### Docker (full stack)
```bash
docker-compose -f docker-compose.dev.yml up --build
```

### Continuous integration
CI runs via GitHub Actions ([`.github/workflows/prototype-tests.yml`](.github/workflows/prototype-tests.yml)).
The legacy `.travis.yml` is **deprecated** (travis-ci.org is shut down) and is
being phased out — see the modernization report.
