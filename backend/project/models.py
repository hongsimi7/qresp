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
    # Descriptive tags for this artifact. A SEPARATE field from URLs, which
    # holds links: the two were conflated in the curator form for a long time
    # and must never share storage. Optional and absent-safe, so every record
    # written before it existed loads as an empty list with no migration.
    keywords = ListField()
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
    # Descriptive tags for this artifact. A SEPARATE field from URLs, which
    # holds links: the two were conflated in the curator form for a long time
    # and must never share storage. Optional and absent-safe, so every record
    # written before it existed loads as an empty list with no migration.
    keywords = ListField()
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


class RelatedResearchCache(Document):
    """External Related Research results for one record, kept OUT of the
    canonical Paper document.

    Recommendations are a derived, perishable view: pinning them into Paper
    would freeze them at curation time and make a read look like an edit.
    They live here instead, keyed by paper id, with an explicit expiry so a
    later follow-up study can appear on its own.

    Stored: only the provider's public bibliographic metadata for the
    candidates that already passed Qresp's quality gate, plus the reasons
    Qresp computed. Never stored: the API key, any header, any provider error
    body, any session/user/owner data, any RCC URL or file path, any file
    content. `results` is empty for a `status` other than 'ok'.

    `last_success_at` outlives a failed refresh on purpose: it is what lets a
    stale-but-real answer be served when the provider is unreachable.
    """
    # The record this entry is about, ACROSS servers
    # (project.federation.cache_key). A record on this server keeps its bare
    # id, so every entry written before federation existed is still a hit and
    # no migration is needed; a record read from a federated peer is prefixed
    # with that peer's canonical origin, so two servers that happen to issue
    # the same ObjectId can never serve each other's recommendations.
    paper_id = StringField(required=True, unique=True, max_length=320)
    # SHA-256 of the record's public scientific metadata at the moment these
    # results were computed (project.relatedness.metadata_fingerprint). An
    # entry whose fingerprint no longer matches the record is a MISS whatever
    # its expiry says, so editing a title or an abstract refreshes the answer
    # instead of waiting out the TTL. Absent on entries written before this
    # field existed => also a miss, which is why no migration is needed.
    fingerprint = StringField(max_length=64)
    # Which version of the scoring rules produced `results`. An entry computed
    # under an older algorithm is a MISS whatever its expiry says, so
    # tightening the quality gate immediately stops the weak and empty answers
    # the old gate produced from being served. Absent on entries written
    # before this field existed => also a miss, which is the whole migration.
    algorithm_version = StringField(max_length=16)
    # Why the list is what it is: `ok`, `provider_returned_no_candidates`,
    # `all_candidates_below_quality_gate`, `provider_rate_limited`, ... Kept
    # so "the external list is empty" can be diagnosed from the cache without
    # re-asking the provider. A code, never a provider message.
    reason = StringField(max_length=64)
    provider = StringField(max_length=64)
    # 'ok' (provider answered), 'unresolved' (this paper could not be
    # identified confidently enough to ask), 'unavailable' (provider failed).
    status = StringField(max_length=32)
    results = ListField(DictField())
    fetched_at = DateTimeField()
    last_success_at = DateTimeField()
    expires_at = DateTimeField()
    meta = {
        'collection': 'related_research_cache',
        'indexes': ['paper_id', 'expires_at'],
    }


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
