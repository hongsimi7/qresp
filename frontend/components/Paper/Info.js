import PropTypes from "prop-types";

import Drawer from "../drawer";
import LabelValue from "../labelvalue";

import { Box } from "@mui/material";

const PaperInfo = ({ paperInfo, publicationInfo = null, editor, defaultOpen }) => {
  const { PIs, collections, tags, notebookFile } = paperInfo;

  return (
    <Drawer
      heading="Paper Information"
      editor={editor}
      defaultOpen={defaultOpen}
    >
      <Box sx={{ my: 1 }}>
        {/* Primary-paper bibliography (curator view only; optional so the
            component stays compatible with callers that don't pass it). */}
        {publicationInfo && publicationInfo.title ? (
          <LabelValue label="Title" value={publicationInfo.title} />
        ) : null}
        {publicationInfo && publicationInfo.authors ? (
          <LabelValue label="Authors" value={publicationInfo.authors} />
        ) : null}
        {publicationInfo && publicationInfo.doi ? (
          <LabelValue label="DOI" value={publicationInfo.doi} />
        ) : null}
        {publicationInfo && publicationInfo.publication ? (
          <LabelValue label="Publication" value={publicationInfo.publication} />
        ) : null}
        <LabelValue label="Principal Investigators: " value={PIs} />
        <LabelValue label="Collections" value={collections.join(", ")} />
        <LabelValue label="Tags" value={tags.join(", ")} />
        {notebookFile && (
          <LabelValue label="Main Notebook File" value={notebookFile} />
        )}
      </Box>
    </Drawer>
  );
};

PaperInfo.propTypes = {
  paperInfo: PropTypes.object.isRequired,
  publicationInfo: PropTypes.object,
  editor: PropTypes.func,
  defaultOpen: PropTypes.bool,
};

export default PaperInfo;
