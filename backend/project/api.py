# Connexion 3 handlers run inside the wrapped Flask app's request context, so
# the canonical Flask request proxy is used here (the old
# `from connexion import request, jsonifier` import is gone in Connexion 3;
# `jsonifier` was never used).
import re

from flask import request
from mongoengine import Q as MongoQ

from project.auth import (can_edit_paper, csrf_protect, get_current_user,
                          is_admin, stamp_owner)
from project.paperdao import *
from project.util import Dtree

from project.controllers.preview import Preview
from project.controllers.publish import Publish

# edit swagger.yml file for method changes


def search(searchWord=None, paperTitle=None, doi=None, tags=None, collectionList=None, authorsList=None, publicationList=None):
    """
    This function responds to a request for /api/search
    with the complete lists of papers

    :return list allpaperslist: A list of all papers
    """
    allpaperslist = []
    try:
        dao = PaperDAO()
        if tags:
            tags = tags.split(",")
        if collectionList:
            collectionList = collectionList.split(",")
        if authorsList:
            authorsList = authorsList.split(",")
        if publicationList:
            publicationList = publicationList.split(",")
        allpaperslist = dao.getAllFilteredSearchObjects(searchWord=searchWord, paperTitle=paperTitle, doi=doi,
                                                        tags=tags, collectionList=collectionList,
                                                        authorsList=authorsList, publicationList=publicationList)
    except Exception as e:
        msg = "Exception in search api " + str(e)
        print(msg)
        return msg, 400
    return allpaperslist, 200


def collections():
    """
    This function responds to a request for /api/collections
    with the complete lists of c

    :return list allcollectionlist: A list of all collections
    """
    allcollectionlist = []
    try:
        dao = PaperDAO()
        allcollectionlist = dao.getCollectionList()
    except Exception as e:
        msg = "Exception in collections api " + str(e)
        print(msg)
        return msg, 400
    return list(allcollectionlist), 200


def authors():
    """
    This function responds to a request for /api/authors
    with the complete lists of authors

    :return list allauthorlist: A list of all authors
    """
    allauthorlist = []
    try:
        dao = PaperDAO()
        allauthorlist = dao.getAuthorList()
    except Exception as e:
        msg = "Exception in authors api " + str(e)
        print(msg)
        return msg, 400
    return list(allauthorlist), 200


def publications():
    """
    This function responds to a request for /api/publications
    with the complete lists of publications

    :return list allpublist: A list of all publications
    """
    allpublist = []
    try:
        dao = PaperDAO()
        allpublist = dao.getPublicationList()
    except Exception as e:
        msg = "Exception in publications api " + str(e)
        print(msg)
        return msg, 400
    return list(allpublist), 200


def paper(id):
    """
    This function responds to a request for /api/paper/{id}
    with the details of paper given id

    :return object paperdetail: An object of paper with paper contents
    """
    paperdetail = None
    try:
        dao = PaperDAO()
        paperdetail = dao.getPaperDetails(id)
    except Exception as e:
        msg = "Exception in paper api " + str(e)
        print(msg)
        return msg, 400
    return paperdetail, 200


def workflow(id):
    """
    This function responds to a request for /api/workflow/{id}
    with the workflow given id

    :return:        workflow object
    """
    workflowdetail = None
    try:
        dao = PaperDAO()
        workflowdetail = dao.getWorkflowDetails(id)
    except Exception as e:
        msg = "Exception in workflow api " + str(e)
        print(msg)
        return msg, 400
    return workflowdetail, 200


def chart(id, cid):
    """
    This function responds to a request for /api/paper/{id}/chart/{cid}
    with the chart given id

    :return:        chart object
    """
    chartworkflowdetail = None
    try:
        dao = PaperDAO()
        chartworkflowdetail = dao.getWorkflowForChartDetails(id, cid)
    except Exception as e:
        msg = "Exception in chart api " + str(e)
        print(msg)
        return msg, 400
    return chartworkflowdetail, 200


def dircontents(req):
    """
    This function responds to the request for /api/dircont

    :return: structure object
    """
    link = req['link']
    src = req['src']
    service = req['service']
    services = {}

    try:
        structure = Dtree(link)
        if src == 'http':
            files = structure.fetchForTreeFromHttp()
            if service:
                services = structure.openFileToReadConfigFromHttp('qresp.ini')

        else:
            files = structure.fetchForTreeFromZenodo()
    except Exception as e:
        msg = "Exception in Directory Structure API "+str(e)
        print(msg)
        return msg, 500

    return {"files": files, "services": services}, 200


def generatePreview(paper):
    """
    Generate a preview of the metadata
    Handler for POST: /api/preview 

    :return : ID for the metadata to be previewed
    """
    result = Preview().generateLink(paper)
    if result == 400:
        return "Validation Error, incorrect paper supplied", 400

    if result == 500:
        return "Internal Server Error", 500

    return result, 200


def getPreview(id):
    """
    View the preview of the metadata
    Handler for GET: /api/preview/{id}

    :return: Metadata object using the id provided for the metadata
    """
    result = Preview().getMetadata(id)

    if result == 400:
        return "Preview does not exist, incorrect id", 400

    if result == 500:
        return "Internal Server Error", 500

    return result, 200


@csrf_protect
def publish(paper):
    """
    Validate the paper json and send an email to the user with the link to publish
    Handler for POST: /api/publish

    :return: Metadata object using the id provided for the metadata
    """
    # Production ownership rule: every NEW record must have a verified owner,
    # so publishing now requires an authenticated session (Google in
    # production; dev-login on staging while its gate is enabled). Anonymous
    # browse/search/view and the non-persisting preview flow stay anonymous.
    user = get_current_user()
    if not user:
        return {"msg": "Authentication is required to publish."}, 401

    # The owner always comes from the SESSION; a client-provided value is
    # discarded before stamping. The stamped payload is what gets stored and
    # later inserted on /verify.
    paper.pop("owner_email", None)
    stamp_owner(paper)
    origin = (request.headers.get('origin') or request.host_url or "").strip()
    origin = origin.rstrip("/")
    result = Publish().publish(paper, origin)

    if isinstance(result, int):
        return {"success": True}, 200
    if isinstance(result, dict) and "code" in result:
        return {"msg": result['msg']}, result['code']
    return {"success": True, **result}, 200


def verify(id):
    """
    Add the paper specified by the ID provided from the wait list to the database
    Handler for GET: /api/verify

    :return: Object containing ID for the paper added in it
     Otherwise error,
    """
    result = Publish().verify(id)

    if isinstance(result, str):
        return {"id": result, "error": ""}, 200

    return {"id": '', "error": result['msg']}, result['code']


@csrf_protect
def update_paper(id, paper):
    """
    Update an existing record's metadata
    Handler for PUT: /api/paper/{id}

    Owner/admin only (auth.can_edit_paper). Top-level payload fields are
    merged into the stored document and re-validated by the Paper model;
    server-owned fields can never be changed through the payload.
    """
    user = get_current_user()
    try:
        existing = Paper.objects.get(id=str(id))
    except Exception as e:
        msg = "Exception in update paper api " + str(e)
        print(msg)
        return {"error": "Paper not found"}, 404

    allowed, reason = can_edit_paper(existing, user)
    if not allowed:
        return {"error": reason}, 401 if user is None else 403

    # Server-owned / immutable fields are never taken from the payload.
    for blocked in ("id", "_id", "owner_email", "version", "versions"):
        paper.pop(blocked, None)

    try:
        data = existing.to_mongo().to_dict()
        data.pop("_id", None)
        data.update(paper)
        # Keep only defined model fields (constructor coercion + validation),
        # and force the verified owner from the stored record.
        data = {k: v for k, v in data.items() if k in Paper._fields}
        data["owner_email"] = existing.owner_email
        updated = Paper(**data)
        updated.id = existing.id
        updated.save()
    except Exception as e:
        msg = "Exception in update paper api " + str(e)
        print(msg)
        return {"error": "Invalid paper payload: " + str(e)}, 400

    return {"id": str(existing.id), "success": True}, 200


def raw_paper(id):
    """
    Return the stored record document for editing in the curator
    Handler for GET: /api/paper/{id}/raw

    Owner/admin only (same gate as updates) -- this is the edit flow's data
    source. The public, display-shaped read stays GET /api/paper/{id}.
    Server-owned fields are stripped from the response.
    """
    user = get_current_user()
    try:
        existing = Paper.objects.get(id=str(id))
    except Exception as e:
        msg = "Exception in raw paper api " + str(e)
        print(msg)
        return {"error": "Paper not found"}, 404

    allowed, reason = can_edit_paper(existing, user)
    if not allowed:
        return {"error": reason}, 401 if user is None else 403

    data = existing.to_mongo().to_dict()
    data.pop("_id", None)
    data.pop("owner_email", None)
    return {"id": str(existing.id), "paper": data}, 200


def _paper_summary(paper):
    """Compact record listing entry shared by the admin ownerless inventory
    and the account page."""
    reference = getattr(paper, "reference", None)
    authors = []
    if reference is not None and reference.authors:
        for author in reference.authors:
            name = "%s %s" % (author.firstName or "", author.lastName or "")
            authors.append(name.strip())
    year = None
    if reference is not None and reference.year:
        try:
            year = int(reference.year)
        except (TypeError, ValueError):
            year = None
    return {
        "id": str(paper.id),
        "title": reference.title if reference is not None else "",
        "owner_email": paper.owner_email or None,
        "authors": ", ".join(authors),
        "year": year,
        "tags": list(paper.tags or []),
        "collections": list(paper.collections or []),
    }


def account_papers():
    """
    List records owned by the current session user
    Handler for GET: /api/account/papers

    Powers the /account page. Anonymous requests get 401; admins see only
    THEIR OWN records here (the ownerless inventory is a separate admin
    endpoint).
    """
    user = get_current_user()
    if not user:
        return {"error": "authentication required"}, 401

    email = (user.get("email") or "").strip().lower()
    owned = Paper.objects(owner_email=email)
    papers = [_paper_summary(paper) for paper in owned]
    return {"papers": papers, "count": len(papers)}, 200


def _require_admin():
    """Shared guard for admin-only endpoints. Returns None when the session
    user is an admin, otherwise the (body, status) error response."""
    user = get_current_user()
    if not user:
        return {"error": "authentication required"}, 401
    if not is_admin(user):
        return {"error": "only an admin may perform this action"}, 403
    return None


def ownerless_papers():
    """
    List legacy records that have no verified owner yet
    Handler for GET: /api/admin/ownerless-papers

    Admin only. Returns a compact list for the assign-owner workflow,
    including the curator-declared insertedBy email as a SUGGESTION (it is
    unverified and must be confirmed by the admin).
    """
    denied = _require_admin()
    if denied:
        return denied

    ownerless = Paper.objects(
        MongoQ(owner_email__exists=False)
        | MongoQ(owner_email=None)
        | MongoQ(owner_email="")
    )

    papers = []
    for paper in ownerless:
        summary = _paper_summary(paper)
        inserted_by = getattr(getattr(paper, "info", None), "insertedBy", None)
        summary["suggested_owner_email"] = (
            getattr(inserted_by, "emailId", None) or None
        )
        papers.append(summary)

    return {"papers": papers, "count": len(papers)}, 200


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@csrf_protect
def assign_paper_owner(id, body):
    """
    Assign (or with force=true, replace) a record's verified owner
    Handler for PUT: /api/paper/{id}/owner

    Admin only. Sets ONLY owner_email — the write is an atomic field update,
    so legacy documents that would no longer pass full model validation are
    never touched beyond this one field.
    """
    denied = _require_admin()
    if denied:
        return denied

    email = ((body or {}).get("owner_email") or "").strip().lower()
    if not EMAIL_PATTERN.match(email):
        return {"error": "owner_email must be a valid email address"}, 400

    try:
        existing = Paper.objects.get(id=str(id))
    except Exception as e:
        msg = "Exception in assign owner api " + str(e)
        print(msg)
        return {"error": "Paper not found"}, 404

    current = (existing.owner_email or "").strip().lower()
    if current and current != email and not bool((body or {}).get("force")):
        return {
            "error": "record already has owner %s; pass force=true to replace"
                     % current
        }, 409

    Paper.objects(id=existing.id).update(set__owner_email=email)
    return {"id": str(existing.id), "owner_email": email, "success": True}, 200


def paper_permissions(id):
    """
    Report whether the current session may edit the given record
    Handler for GET: /api/paper/{id}/permissions

    :return: permission decision for the frontend to show/hide edit controls;
     the same can_edit_paper rule will guard the future update/deactivate APIs
    """
    user = get_current_user()
    try:
        paper = Paper.objects.get(id=str(id))
    except Exception as e:
        msg = "Exception in paper permissions api " + str(e)
        print(msg)
        return {"error": "Paper not found"}, 404

    allowed, reason = can_edit_paper(paper, user)
    return {
        "can_edit": allowed,
        "reason": reason,
        "owner_email": paper.owner_email,
        "authenticated": user is not None,
        "is_admin": is_admin(user),
    }, 200
