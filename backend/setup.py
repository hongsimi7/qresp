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
    python_requires='>=3.8',
    packages=find_packages(),
    # WTForms/MongoEngine/PyMongo modernized (code updated). Only Flask<2.3 and
    # connexion<3 caps remain -- see FULL_STACK_MODERNIZATION_REPORT.md.
    install_requires=[
        'flask_api',
        'flask<2.3',
        'flask_cors',
        'paramiko',
        'pymongo',
        'cffi',
        'flask-mongoengine',
        'Flask-Session',
        'Flask-WTF',
        'mongoengine',
        'cryptography',
        'jinja2',
        'jsonschema',
        'pyOpenSSL',
        'werkzeug<2.3',
        'itsdangerous',
        'python-dateutil',
        'expiringdict',
        'schedule',
        'wtforms',
        'flask-sitemap',
        'requests_oauthlib',
        'mongomock',
        'connexion[swagger-ui]<3.0',
        'coverage',
        'nose2',
        'lxml',
        'gunicorn'
      ],
    include_package_data=True
)
