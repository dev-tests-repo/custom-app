import { useEffect, useRef, useState } from "react";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  VerticalStack,
  Card,
  useIndexResourceState,
  IndexTable,
  EmptySearchResult,
  Button,
  Badge,
} from "@shopify/polaris";
import { CSVLink } from "react-csv";

import { authenticate } from "../shopify.server";

const PAGE_SIZE = 5;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const after = url.searchParams.get("after");

  const response = await admin.graphql(
    `query getOrders ($pageSize: Int, $after: String) {
        orders (first: $pageSize, after: $after) {
          edges {
            node {
              id
              name
              createdAt
              currentTotalPriceSet {
                shopMoney {
                  amount
                }
              }
              currentSubtotalLineItemsQuantity
              lineItems(first: 30) {
                edges {
                  node {
                    title
                    currentQuantity
                  }
                }
              }
              displayFinancialStatus
              displayFulfillmentStatus
            }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }
    `,
    {
      variables: {
        pageSize: PAGE_SIZE,
        after,
      },
    }
  );

  const mapOrder = (order) => ({
    id: order.id,
    number: order.name,
    date: order.createdAt,
    totalPrice: order.currentTotalPriceSet.shopMoney.amount,
    totalQuantity: order.currentSubtotalLineItemsQuantity,
    lineItems: order.lineItems.edges?.map((edge) => edge.node) ?? [],
    paymentStatus: order.displayFinancialStatus,
    fulfillmentStatus: order.displayFulfillmentStatus,
  });

  const responseJson = await response.json();

  const data = responseJson?.data?.orders;
  const orders = data?.edges?.map((edge) => mapOrder(edge.node)) ?? [];
  const cursor = data?.pageInfo?.endCursor;
  const hasNextPage = data?.pageInfo?.hasNextPage;

  return json({
    orders,
    cursor,
    hasNextPage,
  });
};

export default function Index() {
  const { orders, cursor, hasNextPage } = useLoaderData();
  const fetcher = useFetcher();

  const [allLoadedOrders, setAllLoadedOrders] = useState(orders);
  const [currentCursor, setCurrentCursor] = useState(cursor);
  const [isLastPage, setIsLastPage] = useState(!hasNextPage);

  // Pagination
  useEffect(() => {
    if (fetcher.data) {
      const { orders, cursor, hasNextPage } = fetcher.data;
      setAllLoadedOrders((prev) => [...prev, ...orders]);
      setCurrentCursor(cursor);
      setIsLastPage(!hasNextPage);
    }
  }, [fetcher.data]);

  const loadMoreOrders = () => {
    fetcher.load(`?index&after=${currentCursor}`);
  };

  // CSV
  const csvLinkRef = useRef(null);

  const exportOrders = () => {
    // Simulate click since react-csv doesn't have method to trigger download
    csvLinkRef?.current?.link?.click();
    shopify.toast.show("Exporting...");
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(allLoadedOrders);

  const lineItemsToString = (lineItems) => {
    const items = lineItems.map(
      (item) => `(${item.currentQuantity}x) ${item.title}`
    );

    return items.join(", ");
  };

  const selectedOrdersToCsv = () => {
    if (!selectedResources.length) return "";

    const selectedOrders = allLoadedOrders.filter((order) =>
      selectedResources.includes(order.id)
    );

    const mappedOrders = selectedOrders.map((order) => ({
      ...order,
      lineItems: lineItemsToString(order.lineItems).replace(", ", "|"), // replace separator
    }));

    const headers = Object.keys(mappedOrders[0]).join(",");
    const values = mappedOrders
      .map((order) => Object.values(order).join(","))
      .join("\n");

    const csv = headers + "\n" + values;

    return csv;
  };

  // Components
  const rowMarkup = allLoadedOrders.map(
    (
      {
        id,
        number,
        date,
        totalPrice,
        totalQuantity,
        lineItems,
        paymentStatus,
        fulfillmentStatus,
      },
      index
    ) => (
      <IndexTable.Row
        id={id}
        key={id}
        selected={selectedResources.includes(id)}
        position={index}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {number}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{date}</IndexTable.Cell>
        <IndexTable.Cell>{totalPrice}</IndexTable.Cell>
        <IndexTable.Cell>{totalQuantity}</IndexTable.Cell>
        <IndexTable.Cell>{lineItemsToString(lineItems)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge>{paymentStatus}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge>{fulfillmentStatus}</Badge>
        </IndexTable.Cell>
      </IndexTable.Row>
    )
  );

  const emptyStateMarkup = (
    <EmptySearchResult
      title={"No order found"}
      description={"Looks like there are no orders yet"}
      withIllustration
    />
  );

  const resourceName = {
    singular: "order",
    plural: "orders",
  };

  const isLoadMoreAllowed = !!allLoadedOrders.length && !isLastPage;

  return (
    <Page>
      <ui-title-bar title="Orders">
        {!!selectedResources.length && (
          <button variant="primary" onClick={exportOrders}>
            Export
          </button>
        )}
      </ui-title-bar>

      <Layout>
        <Layout.Section>
          <Card>
            <VerticalStack gap="3">
              <IndexTable
                resourceName={resourceName}
                itemCount={allLoadedOrders.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: "Order" },
                  { title: "Date" },
                  { title: "Total" },
                  { title: "Items count" },
                  { title: "Items" },
                  { title: "Payment status" },
                  { title: "Fulfillment status" },
                ]}
                emptyState={emptyStateMarkup}
              >
                {rowMarkup}
              </IndexTable>

              {isLoadMoreAllowed && (
                <VerticalStack inlineAlign="center">
                  <Button primary onClick={loadMoreOrders}>
                    Load more
                  </Button>
                </VerticalStack>
              )}
            </VerticalStack>
          </Card>
        </Layout.Section>
      </Layout>

      <CSVLink
        ref={csvLinkRef}
        data={selectedOrdersToCsv()}
        filename={"orders.csv"}
        target="_blank"
        style={{ display: "none" }}
      />
    </Page>
  );
}
