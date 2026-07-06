# Connexion 3 handlers run inside the wrapped Flask app's request context, so
# the canonical Flask request proxy is used here (the old
# `from connexion import request, jsonifier` import is gone in Connexion 3;
# `jsonifier` was never used).
from flask import request

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
    # Record the verified session identity (if any) as the record owner; the
    # stamped payload is what gets stored and later inserted on /verify.
    # Anonymous publishing remains allowed (record is then ownerless).
    stamp_owner(paper)
    result = Publish().publish(paper, request.headers.get('origin'))

    if isinstance(result, int):
        return 200
    else:
        return result['msg'], result['code']


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
