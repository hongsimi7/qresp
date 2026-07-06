jest.mock("axios");
import axios from "axios";

import { getServerSideProps } from "../pages/search";

const endpointData = {
  search: [{ _Search__id: "paper-1", _Search__title: "STAGING TEST" }],
  collections: ["MICCOM"],
  authors: ["Giulia Galli"],
  publications: ["Journal"],
};

const mockEndpointResponses = () => {
  axios.get.mockImplementation((url) => {
    const endpoint = url.split("/api/")[1];
    return Promise.resolve({ data: endpointData[endpoint] || [] });
  });
};

describe("search getServerSideProps", () => {
  const originalInternalApi = process.env.QRESP_INTERNAL_API_URL;

  afterEach(() => {
    jest.resetAllMocks();
    if (originalInternalApi === undefined) {
      delete process.env.QRESP_INTERNAL_API_URL;
    } else {
      process.env.QRESP_INTERNAL_API_URL = originalInternalApi;
    }
  });

  it("uses the internal backend for localhost staging while keeping the public server key", async () => {
    process.env.QRESP_INTERNAL_API_URL = "http://backend:5000";
    mockEndpointResponses();

    const result = await getServerSideProps({
      query: { servers: "https://localhost:8443" },
      req: { headers: { host: "localhost:8443" } },
    });

    expect(axios.get).toHaveBeenCalledWith("http://backend:5000/api/search");
    expect(axios.get).toHaveBeenCalledWith(
      "http://backend:5000/api/collections"
    );
    expect(result.props.error.is).toBe(false);
    expect(result.props.selectedservers).toEqual(["https://localhost:8443"]);
    expect(result.props.initialdata.papers).toEqual({
      "https://localhost:8443": endpointData.search,
    });
  });

  it("keeps external federation nodes unchanged", async () => {
    process.env.QRESP_INTERNAL_API_URL = "http://backend:5000";
    mockEndpointResponses();

    await getServerSideProps({
      query: { servers: "https://paperstack.uchicago.edu" },
      req: { headers: { host: "localhost:8443" } },
    });

    expect(axios.get).toHaveBeenCalledWith(
      "https://paperstack.uchicago.edu/api/search"
    );
  });
});

