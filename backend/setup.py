from setuptools import setup,find_packages

setup(
    name='qresp',
    version='2.0.5',
    url='https://qresp.org/',
    entry_points = {
        'console_scripts': ['qresp=project.__main__:main'],
    },
    license='GNU',
    author='Sushant Bansal, Aditya Tanikanti, Marco Govoni',
    author_email='datadev@lists.uchicago.edu',
    description='Qresp "Curation and Exploration of Reproducible Scientific Papers" is a Python application that facilitates the organization, annotation and exploration of data presented in scientific papers. ',
    python_requires='>=3.10',
    packages=find_packages(),
    # Synced with requirements.txt on 2026-07-02 (DEPENDENCY_AUDIT.md): only
    # packages the code actually imports, plus the WSGI/ASGI servers. Test
    # tooling lives in the `test` extra. All version caps lifted (Flask 3 /
    # Connexion 3) -- see FULL_STACK_MODERNIZATION_REPORT.md.
    install_requires=[
        'flask>=3',
        'werkzeug>=3',
        'connexion[flask,swagger-ui,uvicorn]>=3.3',
        'uvicorn-worker',
        'flask_cors',
        'Flask-Session',
        'flask-sitemap',
        'mongoengine',
        'pymongo',
        'wtforms',
        'jsonschema',
        'requests',
        'requests_oauthlib',
        'lxml',
        'gunicorn',
      ],
    extras_require={
        'test': ['nose2', 'coverage', 'mongomock'],
    },
    include_package_data=True
)
