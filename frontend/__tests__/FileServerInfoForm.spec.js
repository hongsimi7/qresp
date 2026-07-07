import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FileServerInfoForm from "../components/CuratorForms/FileServerInfoForm";
import ServerContext from "../Context/Servers/serverContext";
import AlertContext from "../Context/Alert/alertContext";
import SourceTreeContext from "../Context/SourceTree/SourceTreeContext";
import LoadingContext from "../Context/Loading/loadingContext";
import CuratorContext from "../Context/Curator/curatorContext";

const renderForm = () =>
  render(
    <ServerContext.Provider
      value={{
        httpServers: [
          {
            label: "RCC",
            value: "https://notebook.rcc.uchicago.edu/files",
          },
        ],
        setSelectedHttp: jest.fn(),
      }}
    >
      <AlertContext.Provider value={{ setAlert: jest.fn() }}>
        <SourceTreeContext.Provider
          value={{
            setTree: jest.fn(),
            openSelector: jest.fn(),
            setSaveMethod: jest.fn(),
          }}
        >
          <LoadingContext.Provider
            value={{ showLoader: jest.fn(), hideLoader: jest.fn() }}
          >
            <CuratorContext.Provider value={{ setFileServerPath: jest.fn() }}>
              <FileServerInfoForm editor={jest.fn()} />
            </CuratorContext.Provider>
          </LoadingContext.Provider>
        </SourceTreeContext.Provider>
      </AlertContext.Provider>
    </ServerContext.Provider>
  );

describe("FileServerInfoForm", () => {
  it("registers the default File Server radio value without crashing", () => {
    renderForm();

    expect(screen.getByRole("radio", { name: /file server/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /zenodo/i })).not.toBeChecked();
  });

  it("updates the connection type radio through RHF control", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("radio", { name: /zenodo/i }));

    expect(screen.getByRole("radio", { name: /zenodo/i })).toBeChecked();
    expect(
      screen.getByPlaceholderText(/enter zenodo record url/i)
    ).toBeInTheDocument();
  });
});

