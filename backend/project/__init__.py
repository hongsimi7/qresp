import connexion
import mongoengine
import os
from flask_session import Session
from flask_sitemap import Sitemap
from project.config import Config
from flask_cors import CORS

Config.initialize()

# Create the application instance
connexionapp = connexion.FlaskApp(__name__)

# Read the swagger.yml file to configure the endpoints
swagger_file = (os.path.join(os.getcwd(), 'project/swagger.yml'))
connexionapp.add_api(swagger_file)
app = connexionapp.app

# Create protection and session variables
app.secret_key = Config.get_setting('SECRETS','FLASK_SECRET_KEY')
SESSION_TYPE = 'filesystem'
app.config.from_object(__name__)
app.config['env'] = 'DEV'
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
Session(app)
ext = Sitemap(app)
CORS(app)


#initialize db
if Config.get_setting(app.config['env'],'MONGODB_HOST'):
    # flask-mongoengine is unmaintained and blocks Flask>=2.3; the models are
    # plain mongoengine Documents, so connect mongoengine directly instead.
    # Username/password are only passed when configured (empty ini values must
    # not trigger authentication).
    _mongo = dict(
        db=Config.get_setting(app.config['env'],'MONGODB_DB_NAME'),
        host=Config.get_setting(app.config['env'],'MONGODB_HOST'),
        port=int(Config.get_setting(app.config['env'],'MONGODB_PORT')),
    )
    _username = Config.get_setting(app.config['env'],'MONGODB_USERNAME')
    if _username:
        _mongo.update(username=_username,
                      password=Config.get_setting(app.config['env'],'MONGODB_PASSWORD'))
    mongoengine.connect(**_mongo)

from project import routes
