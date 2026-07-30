import { useState, useContext, useEffect } from "react";

import ReferenceInfoForm from "../CuratorForms/ReferenceInfoForm";
import ReferenceC from "../Paper/ReferenceC";

import CuratorContext from "../../Context/Curator/curatorContext";
import CuratorHelperContext from "../../Context/CuratorHelpers/curatorHelperContext";

import SwitchFade from "../switchFade";

const ReferenceInfoElement = () => {
  const { referenceInfo } = useContext(CuratorContext);
  const { editing, setEditing } = useContext(CuratorHelperContext);

  useEffect(() => {
    // A blank new record starts in edit mode. Once the curator is editing,
    // however, importing a manuscript or applying an AI proposal must not
    // turn a newly populated title into an implicit Save/close action.
    // Explicit Save is the only action that closes this section.
    if (!referenceInfo.title && !editing.referenceInfo) {
      setEditing("referenceInfo", true);
    }
  }, [editing.referenceInfo, referenceInfo.title, setEditing]);

  return (
    <SwitchFade
      editing={editing.referenceInfo}
      form={
        <ReferenceInfoForm editor={() => setEditing("referenceInfo", false)} />
      }
      display={
        <ReferenceC
          referenceInfo={referenceInfo}
          editor={() => setEditing("referenceInfo", true)}
          defaultOpen={true}
        />
      }
    />
  );
};

export default ReferenceInfoElement;
