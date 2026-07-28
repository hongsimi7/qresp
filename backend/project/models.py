from mongoengine import *


class Person(DynamicEmbeddedDocument):
    """ Class mapping creators,PIs,authors of paper to mongo database
    """
    firstName = StringField(max_length=50, required=True)
    middleName = StringField(max_length=50)
    lastName = StringField(max_length=50, required=True)
    emailId = StringField(max_length=100)
    affiliation = StringField(max_length=100)


class Info(DynamicEmbeddedDocument):
    """ Class mapping Info section of paper to mongo database
    """
    timeStamp = StringField()
    notebookPath = StringField()
    serverPath = StringField()
    notebookFile = StringField()
    insertedBy = EmbeddedDocumentField(Person)
    downloadPath = StringField()
    fileServerPath = StringField()
    isPublic = BooleanField()
    folderAbsolutePath = StringField()
    doi = StringField()
    meta = {'strict': False}


class ExtraFields(DynamicEmbeddedDocument):
    """ Extra fields
    """
    extrakey = StringField()
    extravalue = StringField()


class Charts(DynamicEmbeddedDocument):
    """ Class mapping Charts section of paper to mongo database
    """
    caption = StringField()
    id = StringField(required=True)
    imageFile = StringField(required=True)
    files = ListField()
    number = StringField()
    properties = ListField(required=True)
    extraFields = ListField()
    saveas = StringField()
    meta = {'strict': False}


class Tools(DynamicEmbeddedDocument):
    """ Class mapping Tools section of paper to mongo database
    """
    id = StringField()
    kind = StringField()
    packageName = StringField()
    version = StringField()
    programName = StringField()
    files = ListField()
    readme = StringField()
    facilityname = StringField()
    measurement = StringField()
    URLs = ListField()
    extraFields = ListField()
    saveas = StringField()
    meta = {'strict': False}


class Datasets(DynamicEmbeddedDocument):
    """ Class mapping Datasets section of paper to mongo database
    """
    id = StringField()
    files = ListField()
    readme = StringField()
    URLs = ListField()
    extraFields = ListField()
    saveas = StringField()
    meta = {'strict': False}


class Scripts(DynamicEmbeddedDocument):
    """ Class mapping Datasets section of paper to mongo database
    """
    id = StringField()
    files = ListField()
    readme = StringField()
    URLs = ListField()
    extraFields = ListField()
    saveas = StringField()
    meta = {'strict': False}


class Journal(DynamicEmbeddedDocument):
    """ Class mapping Journal section of reference to mongo database
    """
    abbrevName = StringField()
    fullName = StringField()


class Reference(DynamicEmbeddedDocument):
    """ Class mapping Reference section of paper to mongo database
    """
    DOI = StringField()
    authors = ListField(EmbeddedDocumentField(Person))
    journal = EmbeddedDocumentField(Journal)
    kind = StringField()
    page = StringField()
    publishedAbstract = StringField()
    title = StringField()
    volume = StringField()
    year = DecimalField()
    meta = {'strict': False,
            'indexes': [
                {'title', 'unique'},
                'publishedAbstract'
            ]}


class Documentation(DynamicEmbeddedDocument):
    """ Class mapping Datasets section of paper to mongo database
    """
    readme = StringField()
    meta = {'strict': False}


class Heads(DynamicEmbeddedDocument):
    """ Class mapping Heads section of paper to mongo database
    """
    readme = StringField()
    files = ListField()
    URLs = ListField()
    id = StringField()
    saveas = StringField()
    meta = {'strict': False}


class Workflow(DynamicEmbeddedDocument):
    """ Class mapping Workflow section of paper to mongo database
    """
    edges = ListField(ListField())
    nodes = ListField()
    meta = {'strict': False}


class FilterQuerySet(QuerySet):
    """ Class to filter query on mongo database
    """

    def get_unique_values(self, field):
        """ fetches list of unique collections , journal names
        :param field: field to filter on in database
        :return: list of field values
        """
        unique_values = {
            str(v).lower(): v for v in self.distinct(field=field)}.values()
        return unique_values

    def get_unique_names(self, field):
        """ Fetches list of unique names
        :param field: str: filters on name
        :return: list : full names
        """
        unique_values = {str(v.firstName.lower()) + " " + str(v.lastName.lower()): v.firstName + " " + v.lastName for v
                         in self.distinct(field=field)}.values()
        return unique_values


class Paper(Document):
    """ Class to filter query on mongo database
    """
    version = LongField()
    PIs = ListField(EmbeddedDocumentField(Person))
    info = EmbeddedDocumentField(Info)
    charts = ListField(EmbeddedDocumentField(Charts))
    datasets = ListField(EmbeddedDocumentField(Datasets))
    tools = ListField(EmbeddedDocumentField(Tools))
    scripts = ListField(EmbeddedDocumentField(Scripts))
    reference = EmbeddedDocumentField(Reference)
    heads = ListField(EmbeddedDocumentField(Heads))
    workflow = EmbeddedDocumentField(Workflow)
    documentation = EmbeddedDocumentField(Documentation)
    collections = ListField(required=True)
    schema = StringField(required=True)
    tags = ListField(required=True)
    versions = ListField()
    license = StringField(required=True)
    # Verified identity (session email) of the account that published this
    # record; stamped at publish time (project/auth.py stamp_owner). Absent on
    # legacy records => "ownerless": readable by all, editable only by admins.
    # Distinct from info.insertedBy.emailId, which is curator-DECLARED, not
    # verified.
    owner_email = StringField(max_length=254)
    # Additional verified emails allowed to EDIT this record (not manage it:
    # deactivation, owner assignment and this list itself stay owner/admin
    # only). Absent on legacy records => no editors. Managed exclusively via
    # PUT /api/paper/{id}/editors; normalized lowercase there.
    editor_emails = ListField(StringField(max_length=254))
    # Soft-deactivation flag. Absent on legacy records => active; only an
    # explicit False hides a record from public search/explorer/detail. Owner
    # or admin can toggle it (project.api.set_paper_active). Preferred over
    # physical delete so published records are preserved and reversible.
    is_active = BooleanField(default=True)
    # Minimal audit trail, stamped server-side on every successful mutation
    # (edit / assign_owner / update_editors / deactivate / reactivate).
    # Absent on legacy records. edit_history entries are
    # {email, action, timestamp(iso)} dicts appended chronologically.
    updated_at = DateTimeField()
    updated_by_email = StringField(max_length=254)
    edit_history = ListField(DictField())
    meta = {'strict': False,
            'queryset_class': FilterQuerySet
            }


class ExternalIdentity(Document):
    """Durable account identity asserted by an external identity provider
    (Microsoft Entra work/school accounts, Google).

    Keyed by the IMMUTABLE OIDC pair issuer+subject — never by email, which
    institutions can change or reassign. The asserted email/name are stored
    for display and for the CURRENT email-based ownership/admin checks; the
    future ownership migration (owner_account_id) will reference this
    document's id instead. No provider tokens are ever stored here.
    """
    issuer = StringField(required=True)
    subject = StringField(required=True)
    # 'microsoft' | 'google'. Rows written by the retired CILogon broker
    # ('cilogon') may still exist and are simply left unused — nothing reads
    # them and no migration is performed.
    provider = StringField(required=True)
    email = StringField(max_length=254)    # normalized asserted email
    name = StringField()
    idp_name = StringField()               # e.g. the university name, if asserted
    created_at = DateTimeField()
    last_login_at = DateTimeField()
    meta = {
        'collection': 'external_identities',
        'indexes': [
            {'fields': ['issuer', 'subject'], 'unique': True},
            'email',
        ],
    }


class AssistUsage(Document):
    """Per-user daily counter for AI-assist requests (keyword suggestions).
    Persistent so one account cannot exhaust the provider quota; only the
    session email, day, and a count are stored — never request content."""
    email = StringField(required=True, max_length=254)
    day = StringField(required=True, max_length=10)  # YYYY-MM-DD (UTC)
    count = LongField(default=0)
    meta = {
        'collection': 'assist_usage',
        'indexes': [{'fields': ['email', 'day'], 'unique': True}],
    }


def active_papers():
    """Queryset of records visible to the public: legacy records without the
    flag (field absent) and explicitly active ones. Only an explicit
    is_active=False hides a record from public discovery surfaces."""
    return Paper.objects(is_active__ne=False)


class CuratorDraft(Document):
    """Account-owned curator draft saved explicitly from /curator.

    `state` is the raw serialized curator state and is deliberately NOT
    publish/schema-validated — a draft may be arbitrarily incomplete. Drafts
    are private to their owner (looked up by the verified session email).
    """
    owner_email = StringField(required=True, max_length=254)
    title = StringField(default="")
    state = DictField()
    created_at = DateTimeField()
    updated_at = DateTimeField()
    meta = {
        'collection': 'curator_drafts',
        'indexes': ['owner_email'],
    }
